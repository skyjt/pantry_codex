import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  MSG_TYPES,
  TEXT_UDP_LIMIT,
  type Envelope,
  type MsgPayload
} from '../../shared/protocol'
import type { ConversationView, MessageView, MsgStatusEvent } from '../../shared/ipc'
import { makeEnvelope } from '../net/codec'
import type { Messenger } from '../net/messenger'
import { ConvRepo, type ConvRow } from '../store/conv-repo'
import { MsgRepo, msgRowToView } from '../store/msg-repo'

// 聊天用例编排（tech-design §3）：发消息 = 写库 → 网络 → 状态回推。
// 事件出口：'message'（新消息入库）、'status'（发送状态变化）、'convs'（会话列表变化）。
// 不依赖 Electron —— index.ts 负责把事件桥接到窗口。

export interface ChatDeps {
  selfId: string
  convRepo: ConvRepo
  msgRepo: MsgRepo
  messenger: Messenger
  /** 打开会话时的探活回调（F-DISC-8），由 index 接 discovery.probeNode */
  probe?: (peerId: string) => void
}

function toConvView(row: ConvRow): ConversationView {
  return {
    id: row.id,
    type: 'single',
    peerId: row.peer_or_group_id,
    lastTs: row.last_ts,
    unread: row.unread,
    pinned: row.pinned !== 0,
    muted: row.muted !== 0,
    preview: row.preview ?? ''
  }
}

const toMsgView = msgRowToView

export class ChatService extends EventEmitter {
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

  /** 发文本：入库（sending）→ 立即回显 → 异步走网络，结果经 status 事件回推 */
  sendText(peerId: string, text: string): MessageView | null {
    const trimmed = text.trim()
    if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > TEXT_UDP_LIMIT) return null

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

  /** 周期清理：被裁剪出队的消息标记为失败 */
  prune(): void {
    for (const msgId of this.deps.messenger.prune()) {
      this.applyStatus(msgId, 'failed')
    }
  }

  private onIncoming(env: Envelope): void {
    if (env.type !== MSG_TYPES.msg) return // file-ctl 等其他可靠类型由对应服务处理
    const payload = env.payload as MsgPayload
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
  }

  private applyStatus(msgId: string, status: MessageView['status']): void {
    const row = this.deps.msgRepo.get(msgId)
    if (!row) return
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
