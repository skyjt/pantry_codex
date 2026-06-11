// 协议常量与报文类型 —— docs/protocol.md 的 TS 化（唯一来源，main / renderer / 测试共用）

export const PROTOCOL_VERSION = 1

export const DEFAULT_UDP_PORT = 17878
export const DEFAULT_TCP_PORT = 17879

/** 出站单包上限，防 IP 分片（protocol §2） */
export const UDP_MAX_PAYLOAD = 1200
/** 入站硬上限，超过直接丢弃 */
export const UDP_MAX_INBOUND = 4096
/** 文本超过此长度走 TCP（protocol §9，v0.1 暂未用到） */
export const TEXT_UDP_LIMIT = 800

/** 时序参数（protocol §9）。测试中可整体注入缩短。 */
export const TIMINGS = {
  presenceInterval: 30_000,
  offlineAfter: 90_000,
  sweepInterval: 10_000,
  /** entry 应答抖动起步窗口：0–2s（§6.1） */
  entryReplyJitterBase: 2_000,
  /** 抖动窗口按在线规模自适应的上限：0–8s（§6.1 批量开机对策） */
  entryReplyJitterMax: 8_000,
  /** 对同一节点 10s 内不重复应答 alive（§6.1） */
  aliveDedupWindow: 10_000,
  /** 探活超时（§6.2 按需探活） */
  probeTimeout: 2_000,
  /** msg 的 ACK 退避重传间隔（§7.2）：发送后依次等待，仍无 ACK 即入补发队列 */
  ackRetrySchedule: [1_000, 2_000, 4_000] as number[],
  /** 补发队列保留时长 / 单节点上限（决议 #6） */
  queueTtl: 7 * 24 * 3_600_000,
  queueMaxPerPeer: 200,
  /** 已收消息 ID 去重窗口（§7.2） */
  dedupTtl: 24 * 3_600_000
}
export type Timings = typeof TIMINGS

/** 字段长度上限（入站校验白名单，protocol §1 第 5 条） */
export const LIMITS = {
  nick: 32,
  company: 32,
  dept: 32,
  team: 32,
  host: 64,
  ver: 16,
  caps: 16,
  capItem: 16,
  type: 32,
  id: 64,
  from: 64
}

export type Platform = 'win' | 'mac' | 'linux'

/** 节点资料（protocol §3），随 entry / alive / profile 报文携带 */
export interface Profile {
  nodeId: string
  nick: string
  company: string
  dept: string
  team: string
  /** 内置头像编号；-1 = 昵称色块 */
  avatar: number
  /** 资料版本号，每次修改 +1；presence 携带，用于失配刷新 */
  profileRev: number
  host: string
  platform: Platform
  tcpPort: number
  /** 应用版本，"内网有新版"提示的依据 */
  ver: string
  /** 能力声明，供未来扩展探测 */
  caps: string[]
}

/** 报文信封（protocol §4） */
export interface Envelope<T = unknown> {
  v: number
  type: string
  id: string
  from: string
  ts: number
  payload: T
}

/** entry / alive / profile 的载荷 */
export interface ProfilePayload {
  profile: Profile
}

/** presence 心跳载荷（§6.2） */
export interface PresencePayload {
  seq: number
  profileRev: number
}

/** exit 载荷（空对象） */
export type ExitPayload = Record<string, never>

/** 用户消息载荷（§7.1）。v0.1 仅 text；image/sticker/group-text 随功能落地扩展 */
export interface MsgPayload {
  kind: 'text'
  text: string
  /** 补发标记：消息保持原 id/ts，落在历史正确位置 */
  resend?: boolean
}

/** ACK 载荷（§7.2） */
export interface AckPayload {
  ackFor: string
}

export const MSG_TYPES = {
  entry: 'entry',
  alive: 'alive',
  exit: 'exit',
  presence: 'presence',
  profile: 'profile',
  peers: 'peers',
  msg: 'msg',
  ack: 'ack',
  fileCtl: 'file-ctl',
  group: 'group'
} as const
