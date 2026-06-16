import {
  MSG_TYPES,
  SCAN_RANGES_PER_PACKET,
  TIMINGS,
  type Envelope,
  type ScanRangeSummary,
  type ScanRangesPayload,
  type Timings
} from '../../shared/protocol'
import { makeEnvelope } from './codec'
import { normalizeCidr } from './cidr'
import type { PeerRegistry } from './peer-registry'
import type { UdpChannel } from './udp'

export interface RangeSyncOptions {
  udp: UdpChannel
  registry: PeerRegistry
  selfId: string
  /** 返回当前可分享的网段记录。调用方负责过滤用户忽略项。 */
  getRanges: () => ScanRangeSummary[]
  /** 收到远端网段记录。调用方负责持久化、来源展示和后台扫描调度。 */
  acceptRanges: (fromNodeId: string, ranges: ScanRangeSummary[]) => void
  timings?: Partial<Timings>
}

/**
 * 网段记录同步（protocol §6.4）：只同步 CIDR 配置候选，不直接执行扫描。
 * 扫描由主进程按本机节流策略排队，避免多客户端收到同一记录后同时全网探测。
 */
export class RangeSync {
  private readonly udp: UdpChannel
  private readonly registry: PeerRegistry
  private readonly selfId: string
  private readonly getRanges: () => ScanRangeSummary[]
  private readonly acceptRanges: (fromNodeId: string, ranges: ScanRangeSummary[]) => void
  private readonly t: Timings

  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private readonly peerTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(opts: RangeSyncOptions) {
    this.udp = opts.udp
    this.registry = opts.registry
    this.selfId = opts.selfId
    this.getRanges = opts.getRanges
    this.acceptRanges = opts.acceptRanges
    this.t = { ...TIMINGS, ...opts.timings }
    this.udp.on('envelope', (env: Envelope, known: boolean) => {
      if (known && env.type === MSG_TYPES.scanRanges) this.handle(env)
    })
    this.registry.on('online', (nodeId: string) => this.scheduleShareTo(nodeId))
  }

  start(): void {
    this.scheduleShareSoon()
    this.intervalTimer = setInterval(() => this.shareNow(), this.t.scanRangeShareInterval)
    this.intervalTimer.unref?.()
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    for (const timer of this.peerTimers.values()) clearTimeout(timer)
    this.initialTimer = null
    this.intervalTimer = null
    this.peerTimers.clear()
  }

  /** 本机新增网段后调用：抖动后再分享，避免配置保存瞬间形成广播峰值。 */
  scheduleShareSoon(): void {
    if (this.initialTimer) return
    const delay = this.randomBetween(
      this.t.scanRangeShareInitialMin,
      this.t.scanRangeShareInitialMax
    )
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null
      this.shareNow()
    }, delay)
    this.initialTimer.unref?.()
  }

  /** 测试和周期兜底使用：把当前网段记录发给所有在线节点。 */
  shareNow(): void {
    const ranges = this.currentRanges()
    if (ranges.length === 0) return
    for (const record of this.registry.list()) {
      if (record.online) this.sendRangesTo(record.profile.nodeId, ranges)
    }
  }

  private scheduleShareTo(nodeId: string): void {
    if (nodeId === this.selfId || this.peerTimers.has(nodeId)) return
    const delay = this.randomBetween(
      this.t.scanRangeShareInitialMin,
      this.t.scanRangeShareInitialMax
    )
    const timer = setTimeout(() => {
      this.peerTimers.delete(nodeId)
      this.sendRangesTo(nodeId, this.currentRanges())
    }, delay)
    this.peerTimers.set(nodeId, timer)
    timer.unref?.()
  }

  private sendRangesTo(nodeId: string, ranges: ScanRangeSummary[]): void {
    if (ranges.length === 0) return
    const target = this.registry.get(nodeId)
    if (!target || !target.online) return
    for (let i = 0; i < ranges.length; i += SCAN_RANGES_PER_PACKET) {
      const payload: ScanRangesPayload = {
        ranges: ranges.slice(i, i + SCAN_RANGES_PER_PACKET)
      }
      this.udp.send(
        makeEnvelope(MSG_TYPES.scanRanges, this.selfId, payload),
        target.ip,
        target.udpPort
      )
    }
  }

  private handle(env: Envelope): void {
    if (env.from === this.selfId) return
    const payload = env.payload as ScanRangesPayload
    const ranges: ScanRangeSummary[] = []
    const seen = new Set<string>()
    for (const item of payload.ranges) {
      const cidr = normalizeCidr(item.cidr)
      if (!cidr || seen.has(cidr)) continue
      seen.add(cidr)
      ranges.push({ cidr, addedAt: item.addedAt })
    }
    if (ranges.length > 0) this.acceptRanges(env.from, ranges)
  }

  private currentRanges(): ScanRangeSummary[] {
    const now = Date.now()
    const seen = new Set<string>()
    const ranges: ScanRangeSummary[] = []
    for (const item of this.getRanges()) {
      const cidr = normalizeCidr(item.cidr)
      if (!cidr || seen.has(cidr)) continue
      seen.add(cidr)
      ranges.push({ cidr, addedAt: item.addedAt > 0 ? item.addedAt : now })
    }
    return ranges
  }

  private randomBetween(min: number, max: number): number {
    if (max <= min) return Math.max(0, min)
    return min + Math.floor(Math.random() * (max - min + 1))
  }
}
