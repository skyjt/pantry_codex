import { EventEmitter } from 'node:events'
import type { Profile } from '../../shared/protocol'

export interface PeerRecord {
  profile: Profile
  ip: string
  udpPort: number
  lastSeen: number
  online: boolean
}

/**
 * 节点表（内存态）。SQLite 持久化（F-DISC-7 联系人持久保留）随存储层落地。
 * 事件：'updated'（任何可见变化后触发一次，监听方自行节流）。
 */
export class PeerRegistry extends EventEmitter {
  private readonly peers = new Map<string, PeerRecord>()

  constructor(private readonly selfNodeId: string) {
    super()
  }

  /** 启动时把持久化的历史联系人以离线态种回（F-DISC-7）；不覆盖已有记录 */
  seed(records: PeerRecord[]): void {
    let changed = false
    for (const record of records) {
      const id = record.profile.nodeId
      if (id === this.selfNodeId || this.peers.has(id)) continue
      this.peers.set(id, { ...record, online: false })
      changed = true
    }
    if (changed) this.emit('updated')
  }

  /** 收到对端任意报文时调用；带 profile 的报文（entry/alive/profile）会更新资料 */
  touch(nodeId: string, ip: string, udpPort: number, profile?: Profile): PeerRecord | null {
    if (nodeId === this.selfNodeId) return null

    const now = Date.now()
    const existing = this.peers.get(nodeId)
    let changed = false

    if (!existing) {
      if (!profile) return null // 没见过又没带资料的节点，等它的 entry/alive
      const record: PeerRecord = { profile, ip, udpPort, lastSeen: now, online: true }
      this.peers.set(nodeId, record)
      this.emit('updated')
      this.emit('online', nodeId) // 新节点即在线：触发补发等待者（messenger）
      return record
    }

    let cameOnline = false
    if (!existing.online) {
      existing.online = true
      changed = true
      cameOnline = true
    }
    if (existing.ip !== ip || existing.udpPort !== udpPort) {
      existing.ip = ip
      existing.udpPort = udpPort
      changed = true
    }
    if (profile && profile.profileRev >= existing.profile.profileRev) {
      if (profile.profileRev > existing.profile.profileRev || profile.nick !== existing.profile.nick) {
        changed = true
      }
      existing.profile = profile
    }
    existing.lastSeen = now

    if (changed) this.emit('updated')
    // 放在所有字段更新之后：emit 是同步的，监听者（messenger 补发）要拿到最新地址（§7.2）
    if (cameOnline) this.emit('online', nodeId)
    return existing
  }

  get(nodeId: string): PeerRecord | undefined {
    return this.peers.get(nodeId)
  }

  /** 对端 profileRev（用于 presence 失配检测）；未知返回 -1 */
  profileRevOf(nodeId: string): number {
    return this.peers.get(nodeId)?.profile.profileRev ?? -1
  }

  markOffline(nodeId: string): void {
    const record = this.peers.get(nodeId)
    if (record && record.online) {
      record.online = false
      this.emit('updated')
    }
  }

  /** 心跳超时离线判定（protocol §6.2），由 Discovery 周期调用 */
  sweep(offlineAfterMs: number): void {
    const now = Date.now()
    let changed = false
    for (const record of this.peers.values()) {
      if (record.online && now - record.lastSeen > offlineAfterMs) {
        record.online = false
        changed = true
      }
    }
    if (changed) this.emit('updated')
  }

  onlineCount(): number {
    let n = 0
    for (const record of this.peers.values()) {
      if (record.online) n += 1
    }
    return n
  }

  /** 在线优先，再按昵称排序（通讯录展示顺序的最小实现） */
  list(): PeerRecord[] {
    return [...this.peers.values()].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      return a.profile.nick.localeCompare(b.profile.nick, 'zh-Hans-CN')
    })
  }
}
