// 时钟偏移矫正（决议 #65）：纯内网无权威时钟、各机系统时间常年不准。每条入站报文都带
// 发送方时间戳（Envelope.ts），收到「实时」报文时用「本机收到时刻 − 报文时间」估出该节点
// 与本机的时钟偏移；显示对方消息时把发送方时间换算到本机时钟，使全部消息按本机这一把
// 尺子对齐、时间一致且近似真实。
//
// 关键约束：
// - 只用「实时」报文观测偏移（发现层 entry/alive/profile/presence、非补发的实时聊天消息）；
//   离线补发 / 历史报文的 ts 不是当前时刻，会污染偏移，禁止 observe。
// - 排序不依赖本模块：消息顺序仍由本地 seq 兜底（决议 #23 注），本模块只影响显示时间。
// - 零协议改动：复用既有 Envelope.ts，不新增字段。
// - 零 Electron 依赖：纯 Map + 算术，vitest 可直接实例化。
export class PeerClock {
  /** nodeId → 该节点时钟相对本机的偏移（本机时间 − 对方时间），毫秒；正值=对方钟慢 */
  private readonly offsets = new Map<string, number>()

  /** 实时报文观测：EMA 平滑（新值权重 0.3）抗内网网络抖动；非法时间戳忽略。 */
  observe(nodeId: string, remoteTs: number, localNow: number): void {
    if (!nodeId || !Number.isFinite(remoteTs) || remoteTs <= 0) return
    const raw = localNow - remoteTs
    const prev = this.offsets.get(nodeId)
    this.offsets.set(nodeId, prev === undefined ? raw : Math.round(prev * 0.7 + raw * 0.3))
  }

  offsetOf(nodeId: string): number {
    return this.offsets.get(nodeId) ?? 0
  }

  /**
   * 把发送方时间换算到本机时钟用于显示；上界钳到 localNow，杜绝"来自未来"的时间。
   * 未观测过的节点偏移按 0（退回显示原始时间，仅做未来钳制），不会比改动前更差。
   */
  correct(nodeId: string, remoteTs: number, localNow: number = Date.now()): number {
    if (!Number.isFinite(remoteTs) || remoteTs <= 0) return remoteTs
    return Math.min(remoteTs + this.offsetOf(nodeId), localNow)
  }
}
