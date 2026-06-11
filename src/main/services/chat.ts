import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  MSG_TYPES,
  RECALL_WINDOW_MS,
  TEXT_TCP_LIMIT,
  type Envelope,
  type MsgPayload
} from '../../shared/protocol'
import type { ConversationView, MessageView, MsgStatusEvent } from '../../shared/ipc'
import { makeEnvelope } from '../net/codec'
import type { Messenger } from '../net/messenger'
import { ConvRepo, convRowToView, type ConvRow } from '../store/conv-repo'
import { GroupRepo } from '../store/group-repo'
import { MsgRepo, msgRowToView, type MsgRow } from '../store/msg-repo'

// 聊天用例编排（tech-design §3）：发消息 = 写库 → 网络 → 状态回推。
// 事件出口：'message'（新消息入库）、'status'（发送状态变化）、'convs'（会话列表变化）。
// 不依赖 Electron —— index.ts 负责把事件桥接到窗口。

export interface ChatDeps {
  selfId: string
  convRepo: ConvRepo
  msgRepo: MsgRepo
  groupRepo?: GroupRepo
  messenger: Messenger
  /** 打开会话时的探活回调（F-DISC-8），由 index 接 discovery.probeNode */
  probe?: (peerId: string) => void
}

const toConvView = convRowToView
const toMsgView = msgRowToView

export class ChatService extends EventEmitter {
  private readonly pendingRecalls = new Map<
    string,
    { env: Envelope<MsgPayload>; timer: ReturnType<typeof setTimeout> }
  >()

  constructor(private readonly deps: ChatDeps) {
    super()

    deps.messenger.on('incoming', (env: Envelope) => this.onIncoming(env))
    deps.messenger.on('status', (msgId: string, status: 'sent') => {
      // 补发成功（queued → sent）
      this.applyStatus(msgId, status)
    })

    const reset = deps.msgRepo.resetStaleSending()
    if (reset > 0) console.warn(`[chat] 启动自愈：${reset} 条残留"发送中"已复位为失败`)
  }

  listConversations(): ConversationView[] {
    return this.deps.convRepo.list().map(toConvView)
  }

  /** 打开会话：建会话（幂等）+ 清未读 + 探活（F-DISC-8 二次校验） */
  openConversation(peerId: string): ConversationView {
    const convId = this.deps.convRepo.ensureSingle(peerId)
    this.deps.convRepo.markRead(convId)
    this.deps.probe?.(peerId)
    this.emitConvs()
    const row = this.deps.convRepo.get(convId)
    return toConvView(row as ConvRow)
  }

  pageMessages(convId: string, beforeSeq: number | null, limit = 50): MessageView[] {
    return this.deps.msgRepo.page(convId, beforeSeq, limit).map(toMsgView)
  }

  markRead(convId: string): void {
    this.deps.convRepo.markRead(convId)
    this.emitConvs()
  }

  setPinned(convId: string, pinned: boolean): void {
    this.deps.convRepo.setPinned(convId, pinned)
    this.emitConvs()
  }

  setMuted(convId: string, muted: boolean): void {
    this.deps.convRepo.setMuted(convId, muted)
    this.emitConvs()
  }

  removeConversation(convId: string): void {
    this.deps.convRepo.remove(convId)
    this.emitConvs()
  }

  /** 发文本：入库（sending）→ 立即回显 → 异步走网络，结果经 status 事件回推 */
  sendText(peerId: string, text: string): MessageView | null {
    const trimmed = text.trim()
    if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > TEXT_TCP_LIMIT) return null

    const convId = this.deps.convRepo.ensureSingle(peerId)
    const env = makeEnvelope<MsgPayload>(MSG_TYPES.msg, this.deps.selfId, {
      kind: 'text',
      text: trimmed
    })
    this.deps.msgRepo.insert({
      id: env.id,
      convId,
      senderId: this.deps.selfId,
      isMine: true,
      kind: 'text',
      content: trimmed,
      ts: env.ts,
      status: 'sending'
    })
    this.deps.convRepo.bump(convId, env.ts)
    this.emitConvs()

    void this.deps.messenger.sendUserMessage(peerId, env).then((outcome) => {
      this.applyStatus(env.id, outcome)
    })

    const row = this.deps.msgRepo.get(env.id)
    return row ? toMsgView(row) : null
  }

  /** 手动重发（失败/排队中的自己的消息）：沿用原 id，对端凭 id 去重 */
  resend(msgId: string): boolean {
    const row = this.deps.msgRepo.get(msgId)
    if (!row || row.is_mine === 0) return false
    if (row.status !== 'failed' && row.status !== 'queued') return false
    const peerId = row.conv_id.startsWith('single:') ? row.conv_id.slice(7) : ''
    if (!peerId) return false

    const env: Envelope<MsgPayload> = {
      v: 1,
      type: MSG_TYPES.msg,
      id: row.id,
      from: this.deps.selfId,
      ts: row.ts,
      payload: { kind: 'text', text: row.content, resend: true }
    }
    this.applyStatus(msgId, 'sending')
    void this.deps.messenger.sendUserMessage(peerId, env).then((outcome) => {
      this.applyStatus(msgId, outcome)
    })
    return true
  }

  /** 撤回自己的消息：本地先隐藏，撤回指令复用可靠消息通道投递给对端/群成员 */
  recall(msgId: string): boolean {
    const row = this.deps.msgRepo.get(msgId)
    if (!row || !this.canRecall(row)) return false

    const payload = this.recallPayloadFor(row)
    if (!payload) return false
    const env = makeEnvelope<MsgPayload>(MSG_TYPES.msg, this.deps.selfId, payload)

    if (row.conv_id.startsWith('single:')) {
      const peerId = row.conv_id.slice(7)
      this.deps.messenger.dropQueuedMessage(row.id, [peerId])
      this.applyRecall(row, env.id, '你撤回了一条消息', env.ts, false)
      void this.deps.messenger.sendUserMessage(peerId, env)
      return true
    }

    const groupId = row.conv_id.startsWith('group:') ? row.conv_id.slice(6) : ''
    const meta = groupId ? this.deps.groupRepo?.get(groupId) : null
    if (!meta || !meta.members.includes(this.deps.selfId)) return false
    const recipients = meta.members.filter((member) => member !== this.deps.selfId)
    this.deps.messenger.dropQueuedMessage(row.id, recipients)
    this.applyRecall(row, env.id, '你撤回了一条消息', env.ts, false)
    for (const member of meta.members) {
      if (member !== this.deps.selfId) void this.deps.messenger.sendUserMessage(member, env)
    }
    return true
  }

  /** 周期清理：被裁剪出队的单聊消息标记为失败（群消息按成员排队，单成员裁剪不改全局状态） */
  prune(): void {
    for (const { msgId } of this.deps.messenger.prune()) {
      const row = this.deps.msgRepo.get(msgId)
      if (row && row.conv_id.startsWith('single:')) this.applyStatus(msgId, 'failed')
    }
  }

  private onIncoming(env: Envelope): void {
    if (env.type !== MSG_TYPES.msg) return // file-ctl 等其他可靠类型由对应服务处理
    const payload = env.payload as MsgPayload
    if (payload.kind === 'recall') {
      this.onIncomingRecall(env as Envelope<MsgPayload>)
      return
    }
    if (payload.kind === 'group-text') {
      this.deferPendingRecall(env.id)
      return
    }
    if (payload.kind !== 'text') return
    const convId = this.deps.convRepo.ensureSingle(env.from)
    const inserted = this.deps.msgRepo.insert({
      id: env.id,
      convId,
      senderId: env.from,
      isMine: false,
      kind: 'text',
      content: payload.text,
      ts: env.ts, // 显示用发送方时间；排序用本地 seq（时钟漂移兜底）
      status: 'sent'
    })
    if (!inserted) return // 持久化去重之外的最后一道闸（messages 主键幂等）
    this.deps.convRepo.bump(convId, env.ts)
    this.deps.convRepo.incUnread(convId)
    const row = this.deps.msgRepo.get(env.id)
    if (row) this.emit('message', toMsgView(row))
    this.emitConvs()
    this.deferPendingRecall(env.id)
  }

  private onIncomingRecall(env: Envelope<MsgPayload>): void {
    const payload = env.payload
    if (payload.kind !== 'recall') return
    const target = this.deps.msgRepo.get(payload.targetId)
    if (!target) {
      this.rememberPendingRecall(payload.targetId, env)
      return
    }
    this.applyIncomingRecall(env, target)
  }

  private rememberPendingRecall(targetId: string, env: Envelope<MsgPayload>): void {
    const old = this.pendingRecalls.get(targetId)
    if (old) clearTimeout(old.timer)
    const timer = setTimeout(() => this.pendingRecalls.delete(targetId), RECALL_WINDOW_MS)
    timer.unref?.()
    this.pendingRecalls.set(targetId, { env, timer })
  }

  private deferPendingRecall(targetId: string): void {
    if (!this.pendingRecalls.has(targetId)) return
    setTimeout(() => {
      const pending = this.pendingRecalls.get(targetId)
      const target = this.deps.msgRepo.get(targetId)
      if (!pending || !target) return
      this.pendingRecalls.delete(targetId)
      clearTimeout(pending.timer)
      this.applyIncomingRecall(pending.env, target)
    }, 0)
  }

  private applyIncomingRecall(env: Envelope<MsgPayload>, target: MsgRow): void {
    const payload = env.payload
    if (payload.kind !== 'recall') return
    if (target.sender_id !== env.from) return
    const expectedConv = payload.groupId ? `group:${payload.groupId}` : `single:${env.from}`
    if (target.conv_id !== expectedConv) return
    if (target.status === 'recalled') return
    this.applyRecall(target, env.id, '对方撤回了一条消息', env.ts, true)
  }

  private canRecall(row: MsgRow): boolean {
    if (row.is_mine === 0) return false
    if (row.kind !== 'text' || row.status === 'recalled') return false
    return Date.now() - row.ts <= RECALL_WINDOW_MS
  }

  private recallPayloadFor(row: MsgRow): MsgPayload | null {
    if (row.conv_id.startsWith('single:')) {
      return { kind: 'recall', targetId: row.id }
    }
    if (!row.conv_id.startsWith('group:')) return null
    const groupId = row.conv_id.slice(6)
    const meta = this.deps.groupRepo?.get(groupId)
    if (!meta) return null
    return { kind: 'recall', targetId: row.id, groupId, groupRev: meta.rev }
  }

  private applyRecall(
    target: MsgRow,
    tipId: string,
    tip: string,
    ts: number,
    countUnread: boolean
  ): void {
    this.deps.msgRepo.recall(target.id)
    this.emit('status', { id: target.id, convId: target.conv_id, status: 'recalled' } satisfies MsgStatusEvent)

    const inserted = this.deps.msgRepo.insert({
      id: tipId,
      convId: target.conv_id,
      senderId: target.sender_id,
      isMine: false,
      kind: 'system',
      content: tip,
      ts,
      status: 'sent'
    })
    this.deps.convRepo.bump(target.conv_id, ts)
    if (countUnread && inserted) this.deps.convRepo.incUnread(target.conv_id)
    const row = this.deps.msgRepo.get(tipId)
    if (row && inserted) this.emit('message', toMsgView(row))
    this.emitConvs()
  }

  private applyStatus(msgId: string, status: MessageView['status']): void {
    const row = this.deps.msgRepo.get(msgId)
    if (!row) return
    if (row.status === 'recalled' && status !== 'recalled') return
    this.deps.msgRepo.updateStatus(msgId, status)
    const event: MsgStatusEvent = { id: msgId, convId: row.conv_id, status }
    this.emit('status', event)
  }

  private emitConvs(): void {
    this.emit('convs', this.listConversations())
  }
}

export function newMsgId(): string {
  return randomUUID()
}
