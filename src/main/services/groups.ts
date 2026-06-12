import { createHash, randomUUID } from 'node:crypto'
import type { RemoteInfo } from 'node:dgram'
import { EventEmitter } from 'node:events'
import {
  GROUP_MAX_MEMBERS,
  LIMITS,
  MSG_TYPES,
  TEXT_TCP_LIMIT,
  type Envelope,
  type GroupMeta,
  type GroupPayload,
  type MsgPayload
} from '../../shared/protocol'
import type { GroupView, MessageView } from '../../shared/ipc'
import { makeEnvelope } from '../net/codec'
import type { Messenger } from '../net/messenger'
import { ConvRepo, convRowToView } from '../store/conv-repo'
import { MsgRepo, msgRowToView } from '../store/msg-repo'
import { GroupRepo } from '../store/group-repo'

// 讨论组编排（§7.4 / F-MSG-4）：
// 群消息 = 同一信封逐成员单播（离线走补发）；元数据 LWW；
// 不认识的群/rev 落后 → 向发送者 need，对方回 info。
// 事件：'message' / 'convs' / 'group'（与 chat/files 同构，index 桥接到窗口）。

export interface GroupsDeps {
  selfId: string
  messenger: Messenger
  convRepo: ConvRepo
  msgRepo: MsgRepo
  groupRepo: GroupRepo
  /** 当前本机用于“创建 IP 管理”的 IPv4；测试可注入 */
  getSelfIp?: () => string
}

type GroupPatch = { name?: string; add?: string[]; remove?: string[]; adminPassword?: string }

export class GroupsService extends EventEmitter {
  constructor(private readonly deps: GroupsDeps) {
    super()
    deps.messenger.on('incoming', (env: Envelope, rinfo?: RemoteInfo) => {
      if (env.type === MSG_TYPES.group) this.onGroupCtl(env, rinfo)
      else if (env.type === MSG_TYPES.msg) this.onIncomingMsg(env)
    })
  }

  // ---------- 查询 ----------

  toView(meta: GroupMeta): GroupView {
    return {
      groupId: meta.groupId,
      name: meta.name,
      members: meta.members,
      rev: meta.rev,
      amMember: meta.members.includes(this.deps.selfId),
      creatorIp: meta.creatorIp,
      hasAdminPassword: meta.adminSecretHash.length > 0,
      adminHint: meta.adminHint,
      canManage: this.canManageWithoutPassword(meta)
    }
  }

  get(groupId: string): GroupView | null {
    const meta = this.deps.groupRepo.get(groupId)
    return meta ? this.toView(meta) : null
  }

  list(): GroupView[] {
    return this.deps.groupRepo.list().map((m) => this.toView(m))
  }

  // ---------- 建群 / 改群 / 退群 ----------

  createGroup(
    name: string,
    memberIds: string[],
    adminPassword = '',
    adminHint = ''
  ): GroupView | null {
    const members = [...new Set([this.deps.selfId, ...memberIds])].slice(0, GROUP_MAX_MEMBERS)
    if (members.length < 2) return null
    const groupId = randomUUID()
    const secret = normalizeAdminPassword(adminPassword)
    const meta: GroupMeta = {
      groupId,
      name: name.trim().slice(0, 32) || '讨论组',
      members,
      rev: 1,
      updatedBy: this.deps.selfId,
      updatedTs: Date.now(),
      creatorIp: this.selfIp(),
      adminSecretHash: secret ? groupAdminSecretHash(groupId, secret) : '',
      adminHint: secret ? normalizeAdminHint(adminHint) : ''
    }
    this.deps.groupRepo.save(meta)
    this.deps.convRepo.ensureGroup(meta.groupId)
    this.broadcastInfo(meta, members)
    this.emitConvs()
    this.emit('group', this.toView(meta))
    return this.toView(meta)
  }

  /** 改名/增删人按决议 #27 校验：管理密码或创建 IP。 */
  updateGroup(groupId: string, patch: GroupPatch): GroupView | null {
    const meta = this.deps.groupRepo.get(groupId)
    if (!meta || !meta.members.includes(this.deps.selfId)) return null
    if (!this.canManage(meta, patch.adminPassword)) return null

    const oldMembers = meta.members
    let members = [...meta.members]
    for (const id of patch.add ?? []) if (!members.includes(id)) members.push(id)
    if (patch.remove) members = members.filter((id) => !patch.remove!.includes(id))
    members = members.slice(0, GROUP_MAX_MEMBERS)
    if (members.length === 0) return null

    const next: GroupMeta = {
      ...meta,
      name: (patch.name ?? meta.name).trim().slice(0, 32) || meta.name,
      members,
      rev: meta.rev + 1,
      updatedBy: this.deps.selfId,
      updatedTs: Date.now()
    }
    this.deps.groupRepo.save(next)
    // 新旧成员全集都要收到 info：被移出者借此得知（§7.4）
    this.broadcastInfo(next, [...new Set([...oldMembers, ...members])])
    this.emitConvs()
    this.emit('group', this.toView(next))
    return this.toView(next)
  }

  leaveGroup(groupId: string): void {
    const meta = this.deps.groupRepo.get(groupId)
    if (!meta || !meta.members.includes(this.deps.selfId)) return
    const members = meta.members.filter((id) => id !== this.deps.selfId)
    if (members.length === meta.members.length) return
    const next: GroupMeta = {
      ...meta,
      members,
      rev: meta.rev + 1,
      updatedBy: this.deps.selfId,
      updatedTs: Date.now()
    }
    this.deps.groupRepo.save(next)
    this.broadcastInfo(next, meta.members)
    this.emitConvs()
    this.emit('group', this.toView(next))
  }

  // ---------- 群消息 ----------

  sendText(groupId: string, text: string, mentions: string[] = []): MessageView | null {
    const meta = this.deps.groupRepo.get(groupId)
    const trimmed = text.trim()
    if (!meta || !meta.members.includes(this.deps.selfId) || !trimmed) return null
    if (Buffer.byteLength(trimmed, 'utf8') > TEXT_TCP_LIMIT) return null
    const cleanMentions = [...new Set(mentions)]
      .filter((id) => id !== this.deps.selfId && meta.members.includes(id))
      .slice(0, GROUP_MAX_MEMBERS)

    const convId = this.deps.convRepo.ensureGroup(groupId)
    const env = makeEnvelope<MsgPayload>(MSG_TYPES.msg, this.deps.selfId, {
      kind: 'group-text',
      text: trimmed,
      groupId,
      groupRev: meta.rev,
      ...(cleanMentions.length > 0 ? { mentions: cleanMentions } : {})
    })
    // 群消息不做按成员回执（v0.3 简化）：本端入库即 sent，离线成员由补发队列保送达
    this.deps.msgRepo.insert({
      id: env.id,
      convId,
      senderId: this.deps.selfId,
      isMine: true,
      kind: 'text',
      content: trimmed,
      ts: env.ts,
      status: 'sent'
    })
    this.deps.convRepo.bump(convId, env.ts)
    this.emitConvs()

    for (const member of meta.members) {
      if (member !== this.deps.selfId) {
        void this.deps.messenger.sendUserMessage(member, env)
      }
    }
    const row = this.deps.msgRepo.get(env.id)
    return row ? msgRowToView(row) : null
  }

  // ---------- 入站 ----------

  private onIncomingMsg(env: Envelope): void {
    const payload = env.payload as MsgPayload
    if (payload.kind !== 'group-text' || !payload.groupId) return

    const convId = this.deps.convRepo.ensureGroup(payload.groupId)
    const inserted = this.deps.msgRepo.insert({
      id: env.id,
      convId,
      senderId: env.from,
      isMine: false,
      kind: 'text',
      content: payload.text,
      ts: env.ts,
      status: 'sent'
    })
    if (inserted) {
      this.deps.convRepo.bump(convId, env.ts)
      this.deps.convRepo.incUnread(convId)
      const mentioned = Array.isArray(payload.mentions) && payload.mentions.includes(this.deps.selfId)
      if (mentioned) this.deps.convRepo.markMentioned(convId)
      const row = this.deps.msgRepo.get(env.id)
      if (row) {
        const view = msgRowToView(row)
        if (mentioned) view.mentioned = true
        this.emit('message', view)
      }
      this.emitConvs()
    }

    // 不认识该群或本地版本落后 → 向发送者索要全量元数据（§7.4）
    const meta = this.deps.groupRepo.get(payload.groupId)
    if (!meta || (payload.groupRev ?? 0) > meta.rev) {
      void this.deps.messenger.sendReliable(
        env.from,
        makeEnvelope<GroupPayload>(MSG_TYPES.group, this.deps.selfId, {
          op: 'need',
          groupId: payload.groupId
        })
      )
    }
  }

  private onGroupCtl(env: Envelope, rinfo?: RemoteInfo): void {
    const payload = env.payload as GroupPayload
    if (payload.op === 'info') {
      const incoming = normalizeGroupMeta(payload.group)
      const local = this.deps.groupRepo.get(incoming.groupId)
      if (!this.canApplyRemoteInfo(local, incoming, rinfo?.address)) return
      const applied = this.deps.groupRepo.applyRemote(incoming)
      if (applied) {
        this.deps.convRepo.ensureGroup(incoming.groupId)
        this.emitConvs()
        this.emit('group', this.toView(incoming))
      }
      return
    }
    if (payload.op === 'need') {
      const meta = this.deps.groupRepo.get(payload.groupId)
      if (meta && meta.members.includes(this.deps.selfId)) {
        void this.deps.messenger.sendReliable(
          env.from,
          makeEnvelope<GroupPayload>(MSG_TYPES.group, this.deps.selfId, {
            op: 'info',
            group: meta
          })
        )
      }
    }
  }

  /** 元数据投递走可靠通道且离线入队（成员回来即知道自己进了群） */
  private broadcastInfo(meta: GroupMeta, recipients: string[]): void {
    for (const member of recipients) {
      if (member === this.deps.selfId) continue
      const env = makeEnvelope<GroupPayload>(MSG_TYPES.group, this.deps.selfId, {
        op: 'info',
        group: meta
      })
      void this.deps.messenger.sendUserMessage(member, env)
    }
  }

  private emitConvs(): void {
    this.emit('convs', this.deps.convRepo.list().map(convRowToView))
  }

  private selfIp(): string {
    return this.deps.getSelfIp?.() ?? '127.0.0.1'
  }

  private canManageWithoutPassword(meta: GroupMeta): boolean {
    if (!meta.members.includes(this.deps.selfId)) return false
    if (meta.adminSecretHash) return false
    return !meta.creatorIp || meta.creatorIp === this.selfIp()
  }

  private canManage(meta: GroupMeta, adminPassword?: string): boolean {
    if (!meta.members.includes(this.deps.selfId)) return false
    if (!meta.adminSecretHash) return !meta.creatorIp || meta.creatorIp === this.selfIp()
    const secret = normalizeAdminPassword(adminPassword ?? '')
    return secret.length > 0 && groupAdminSecretHash(meta.groupId, secret) === meta.adminSecretHash
  }

  private canApplyRemoteInfo(
    local: GroupMeta | undefined,
    incoming: GroupMeta,
    sourceIp: string | undefined
  ): boolean {
    if (!local) return true
    if (isSelfLeave(local, incoming)) return true
    if (local.adminSecretHash) return incoming.adminSecretHash === local.adminSecretHash
    if (!local.creatorIp) return true // 兼容 v7 前创建的旧组
    return sourceIp === local.creatorIp
  }
}

function normalizeAdminPassword(raw: string): string {
  return raw.trim().slice(0, LIMITS.groupAdminPassword)
}

function normalizeAdminHint(raw: string): string {
  return raw.trim().slice(0, LIMITS.groupAdminHint)
}

function groupAdminSecretHash(groupId: string, password: string): string {
  return createHash('sha256').update(`${groupId}\n${password}`).digest('hex')
}

function normalizeGroupMeta(meta: GroupMeta): GroupMeta {
  const raw = meta as GroupMeta & {
    creatorIp?: unknown
    adminSecretHash?: unknown
    adminHint?: unknown
  }
  const adminSecretHash = typeof raw.adminSecretHash === 'string' ? raw.adminSecretHash : ''
  return {
    ...meta,
    creatorIp: typeof raw.creatorIp === 'string' ? raw.creatorIp : '',
    adminSecretHash,
    adminHint:
      adminSecretHash && typeof raw.adminHint === 'string'
        ? normalizeAdminHint(raw.adminHint)
        : ''
  }
}

function isSelfLeave(local: GroupMeta, incoming: GroupMeta): boolean {
  const removed = local.members.filter((id) => !incoming.members.includes(id))
  const added = incoming.members.filter((id) => !local.members.includes(id))
  return (
    removed.length === 1 &&
    removed[0] === incoming.updatedBy &&
    added.length === 0 &&
    incoming.name === local.name &&
    incoming.creatorIp === local.creatorIp &&
    incoming.adminSecretHash === local.adminSecretHash &&
    incoming.adminHint === local.adminHint
  )
}
