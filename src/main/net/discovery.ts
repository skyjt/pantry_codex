import type { RemoteInfo } from 'node:dgram'
import {
  MSG_TYPES,
  TIMINGS,
  type Envelope,
  type PresencePayload,
  type Profile,
  type ProfilePayload,
  type Timings
} from '../../shared/protocol'
import { makeEnvelope } from './codec'
import type { UdpChannel } from './udp'
import type { PeerRegistry } from './peer-registry'

export interface ManualPeer {
  host: string
  port: number
}

export interface DiscoveryOptions {
  udp: UdpChannel
  registry: PeerRegistry
  profile: Profile
  /** 跨网段/本机联调的手动节点（protocol §6.3 第一板斧） */
  manualPeers?: ManualPeer[]
  /** 测试注入：缩短时序 */
  timings?: Partial<Timings>
}

/**
 * 发现服务（protocol §6）：entry/alive/exit/presence 的全部时序逻辑。
 * 不依赖 Electron —— vitest 里两个实例对发即可集成测试。
 */
export class Discovery {
  private readonly udp: UdpChannel
  private readonly registry: PeerRegistry
  private readonly profile: Profile
  private readonly manualPeers: ManualPeer[]
  private readonly t: Timings

  private presenceSeq = 0
  private presenceTimer: ReturnType<typeof setInterval> | null = null
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly pendingReplies = new Map<string, ReturnType<typeof setTimeout>>()
  /** nodeId → 最近一次发 alive 的时间（§6.1 去重应答，防批量开机风暴） */
  private readonly lastAliveAt = new Map<string, number>()

  constructor(opts: DiscoveryOptions) {
    this.udp = opts.udp
    this.registry = opts.registry
    this.profile = opts.profile
    this.manualPeers = opts.manualPeers ?? []
    this.t = { ...TIMINGS, ...opts.timings }
    this.udp.on('envelope', (env: Envelope, known: boolean, rinfo: RemoteInfo) => {
      if (known) this.handle(env, rinfo)
      // 未知类型按协议忽略（向前兼容）
    })
  }

  private get selfId(): string {
    return this.profile.nodeId
  }

  start(): void {
    this.udp.broadcast(this.envEntry())
    for (const peer of this.manualPeers) {
      this.udp.send(this.envEntry(), peer.host, peer.port)
    }

    this.presenceTimer = setInterval(() => this.sendPresence(), this.t.presenceInterval)
    this.sweepTimer = setInterval(() => this.registry.sweep(this.t.offlineAfter), this.t.sweepInterval)
    this.presenceTimer.unref?.()
    this.sweepTimer.unref?.()
  }

  /** 退出：广播 exit，并对在线节点逐个单播（跨网段节点收不到广播，protocol §6.1） */
  stop(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer)
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const timer of this.pendingReplies.values()) clearTimeout(timer)
    this.pendingReplies.clear()

    const exit = makeEnvelope(MSG_TYPES.exit, this.selfId, {})
    this.udp.broadcast(exit)
    for (const record of this.registry.list()) {
      if (record.online) this.udp.send(exit, record.ip, record.udpPort)
    }
  }

  /** 按需探活（F-DISC-8）：复用 entry，对方回 alive 即在线 */
  probe(host: string, port: number): void {
    this.udp.send(this.envEntry(), host, port)
  }

  /** 探活已知节点；未知节点返回 false */
  probeNode(nodeId: string): boolean {
    const record = this.registry.get(nodeId)
    if (!record) return false
    this.probe(record.ip, record.udpPort)
    return true
  }

  private envEntry(): Envelope<ProfilePayload> {
    return makeEnvelope<ProfilePayload>(MSG_TYPES.entry, this.selfId, { profile: this.profile })
  }

  private sendPresence(): void {
    this.presenceSeq += 1
    const payload: PresencePayload = { seq: this.presenceSeq, profileRev: this.profile.profileRev }
    const env = makeEnvelope(MSG_TYPES.presence, this.selfId, payload)
    this.udp.broadcast(env)
    // 跨网段在线节点单播心跳（protocol §6.2）；同网段节点会重复收到，靠去重无害
    for (const record of this.registry.list()) {
      if (record.online) this.udp.send(env, record.ip, record.udpPort)
    }
  }

  private handle(env: Envelope, rinfo: RemoteInfo): void {
    if (env.from === this.selfId) return // 自己的广播回环

    switch (env.type) {
      case MSG_TYPES.entry: {
        const { profile } = env.payload as ProfilePayload
        this.registry.touch(env.from, rinfo.address, rinfo.port, profile)
        this.scheduleAliveReply(env.from, rinfo)
        break
      }
      case MSG_TYPES.alive:
      case MSG_TYPES.profile: {
        const { profile } = env.payload as ProfilePayload
        this.registry.touch(env.from, rinfo.address, rinfo.port, profile)
        break
      }
      case MSG_TYPES.exit: {
        this.registry.markOffline(env.from)
        break
      }
      case MSG_TYPES.presence: {
        const presence = env.payload as PresencePayload
        const knownRev = this.registry.profileRevOf(env.from)
        this.registry.touch(env.from, rinfo.address, rinfo.port)
        if (knownRev !== -1 && presence.profileRev !== knownRev) {
          // 资料版本失配 → 发 entry 触发对方回 alive（全量资料），§6.2 防"机器换人"
          this.udp.send(this.envEntry(), rinfo.address, rinfo.port)
        }
        break
      }
      default:
        break // 其余已知类型由后续模块（messenger/transfer）接管
    }
  }

  /** entry 应答：规模自适应抖动 + 10s 去重（protocol §6.1 批量开机风暴对策） */
  private scheduleAliveReply(nodeId: string, rinfo: RemoteInfo): void {
    const now = Date.now()
    const last = this.lastAliveAt.get(nodeId) ?? 0
    if (now - last < this.t.aliveDedupWindow) return
    if (this.pendingReplies.has(nodeId)) return

    const online = this.registry.onlineCount()
    const window = Math.min(
      this.t.entryReplyJitterBase + Math.floor(online / 100) * 1000,
      this.t.entryReplyJitterMax
    )
    const delay = Math.floor(Math.random() * Math.max(window, 1))

    const timer = setTimeout(() => {
      this.pendingReplies.delete(nodeId)
      this.lastAliveAt.set(nodeId, Date.now())
      const alive = makeEnvelope<ProfilePayload>(MSG_TYPES.alive, this.selfId, {
        profile: this.profile
      })
      this.udp.send(alive, rinfo.address, rinfo.port)
    }, delay)
    this.pendingReplies.set(nodeId, timer)
  }
}
