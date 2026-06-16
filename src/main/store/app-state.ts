import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson } from '../util/atomic-write'
import { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT, type Platform, type Profile } from '../../shared/protocol'

// 本地状态：identity.json（节点身份，永不变）+ config.json（资料与应用设置）。
// 读写走原子写，避免异常退出留下半截 JSON。

interface IdentityFile {
  nodeId: string
  createdAt: number
}

export interface ConfigFile {
  nick: string
  company: string
  dept: string
  team: string
  avatar: number
  profileRev: number
  /** 首次启动向导是否已完成（F-SYS-6） */
  setupDone: boolean
  /** 文件保存目录；空 = 跟随系统下载目录（文件功能 v0.2 使用） */
  fileDir: string
  /** 新消息系统通知开关 */
  notifications: boolean
  /** 手动添加的节点（"ip" 或 "ip:port"），启动时逐个探测（F-DISC-2 第一板斧） */
  manualPeers: string[]
  /** 网段扫描 CIDR 列表（F-DISC-2 第二板斧） */
  scanRanges: string[]
  /** 网段来源元数据：本机新增或经局域网同事低频同步而来 */
  scanRangeSources: Record<string, ScanRangeSourceRecord>
  /** 用户主动移除过的网段，远端再次同步时不自动加回 */
  ignoredScanRanges: Record<string, number>
  /** 监听端口；保存后重启生效 */
  udpPort: number
  tcpPort: number
  /** 截图时隐藏茶话间窗口（决议 #22，默认开） */
  hideOnCapture: boolean
  /** 开机自启（F-SYS-3，默认开） */
  autoLaunch: boolean
  /** 关闭主窗口行为：true=最小化到托盘，false=退出 */
  closeToTray: boolean
  /** 深色主题手动切换（决议 #24） */
  theme: 'light' | 'dark'
  /** 办公场景护眼字体缩放（百分比） */
  fontScale: 100 | 110 | 125
  /** 通知横幅是否显示消息正文摘要 */
  showMessagePreview: boolean
  /** 提示音：none 默认静音，其余交给系统通知播放 */
  sound: 'none' | 'drop' | 'wood' | 'ding'
  /** 发送键行为 */
  sendKey: 'enter' | 'ctrlEnter'
  /** 截图全局快捷键；空串=禁用 */
  captureShortcut: string
  /** 显示/隐藏主窗快捷键；空串=禁用 */
  showHideShortcut: string
}

export interface ScanRangeSourceRecord {
  source: 'self' | 'remote'
  addedAt: number
  sourceNodeId?: string
  sourceName?: string
  lastAutoScanAt?: number
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function detectPlatform(): Platform {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

function normalizeConfigCidr(input: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(input.trim())
  if (!m) return null
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const prefix = Number(m[5])
  if (octets.some((o) => o > 255) || prefix < 8 || prefix > 30) return null
  const hostBits = 32 - prefix
  const hostCount = 2 ** hostBits - 2
  if (hostCount <= 0 || hostCount > 1024) return null
  const base =
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  const network = (base >> hostBits << hostBits) >>> 0
  return `${(network >>> 24) & 0xff}.${(network >>> 16) & 0xff}.${(network >>> 8) & 0xff}.${network & 0xff}/${prefix}`
}

function cleanScanRangeSourceRecord(value: unknown): ScanRangeSourceRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ScanRangeSourceRecord>
  const addedAt =
    typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) && raw.addedAt > 0
      ? raw.addedAt
      : Date.now()
  const lastAutoScanAt =
    typeof raw.lastAutoScanAt === 'number' &&
    Number.isFinite(raw.lastAutoScanAt) &&
    raw.lastAutoScanAt > 0
      ? raw.lastAutoScanAt
      : undefined
  if (raw.source === 'self') {
    return { source: 'self', addedAt, lastAutoScanAt }
  }
  if (raw.source === 'remote' && typeof raw.sourceNodeId === 'string') {
    return {
      source: 'remote',
      sourceNodeId: raw.sourceNodeId,
      sourceName: typeof raw.sourceName === 'string' ? raw.sourceName : '',
      addedAt,
      lastAutoScanAt
    }
  }
  return null
}

export interface AppState {
  nodeId: string
  profile: Profile
  config: ConfigFile
  configPath: string
}

export interface ProfilePatch {
  nick: string
  company: string
  dept: string
  team: string
  avatar: number
  fileDir: string
}

/**
 * 保存向导/设置提交的资料：资料字段有变则 profileRev+1（触发全网刷新），
 * 同步原地更新 profile 对象（discovery 持引用，presence 立即携带新 rev）。
 */
export function saveProfile(state: AppState, patch: ProfilePatch): void {
  const { config, profile } = state
  const profileChanged =
    patch.nick !== config.nick ||
    patch.company !== config.company ||
    patch.dept !== config.dept ||
    patch.team !== config.team ||
    patch.avatar !== config.avatar

  config.nick = patch.nick
  config.company = patch.company
  config.dept = patch.dept
  config.team = patch.team
  config.avatar = patch.avatar
  config.fileDir = patch.fileDir
  config.setupDone = true
  if (profileChanged) config.profileRev += 1
  atomicWriteJson(state.configPath, config)

  profile.nick = config.nick
  profile.company = config.company
  profile.dept = config.dept
  profile.team = config.team
  profile.avatar = config.avatar
  profile.profileRev = config.profileRev
}

/** 保存应用级设置（通知开关 / 手动节点 / 扫描网段），与资料保存互不影响 */
export function saveAppSettings(
  state: AppState,
  patch: Partial<
    Pick<
      ConfigFile,
      | 'notifications'
      | 'manualPeers'
      | 'scanRanges'
      | 'udpPort'
      | 'tcpPort'
      | 'hideOnCapture'
      | 'autoLaunch'
      | 'closeToTray'
      | 'theme'
      | 'fontScale'
      | 'showMessagePreview'
      | 'sound'
      | 'sendKey'
      | 'captureShortcut'
      | 'showHideShortcut'
    >
  >
): void {
  if (!state.config.scanRangeSources) state.config.scanRangeSources = {}
  if (!state.config.ignoredScanRanges) state.config.ignoredScanRanges = {}
  if (patch.notifications !== undefined) state.config.notifications = patch.notifications
  if (patch.manualPeers !== undefined) state.config.manualPeers = patch.manualPeers
  if (patch.scanRanges !== undefined) {
    const now = Date.now()
    const prev = new Set(state.config.scanRanges)
    const next = [...new Set(patch.scanRanges)]
    const nextSet = new Set(next)
    for (const cidr of prev) {
      if (!nextSet.has(cidr)) {
        state.config.ignoredScanRanges[cidr] = now
        delete state.config.scanRangeSources[cidr]
      }
    }
    for (const cidr of next) {
      if (!prev.has(cidr)) delete state.config.ignoredScanRanges[cidr]
      if (!state.config.scanRangeSources[cidr]) {
        state.config.scanRangeSources[cidr] = { source: 'self', addedAt: now }
      }
    }
    state.config.scanRanges = next
  }
  if (patch.udpPort !== undefined) state.config.udpPort = patch.udpPort
  if (patch.tcpPort !== undefined) state.config.tcpPort = patch.tcpPort
  if (patch.hideOnCapture !== undefined) state.config.hideOnCapture = patch.hideOnCapture
  if (patch.autoLaunch !== undefined) state.config.autoLaunch = patch.autoLaunch
  if (patch.closeToTray !== undefined) state.config.closeToTray = patch.closeToTray
  if (patch.theme !== undefined) state.config.theme = patch.theme
  if (patch.fontScale !== undefined) state.config.fontScale = patch.fontScale
  if (patch.showMessagePreview !== undefined) {
    state.config.showMessagePreview = patch.showMessagePreview
  }
  if (patch.sound !== undefined) state.config.sound = patch.sound
  if (patch.sendKey !== undefined) state.config.sendKey = patch.sendKey
  if (patch.captureShortcut !== undefined) state.config.captureShortcut = patch.captureShortcut
  if (patch.showHideShortcut !== undefined) state.config.showHideShortcut = patch.showHideShortcut
  atomicWriteJson(state.configPath, state.config)
}

export function addSharedScanRanges(
  state: AppState,
  ranges: Array<{ cidr: string; addedAt: number }>,
  source: { nodeId: string; name: string }
): string[] {
  if (!state.config.scanRangeSources) state.config.scanRangeSources = {}
  if (!state.config.ignoredScanRanges) state.config.ignoredScanRanges = {}
  const existing = new Set(state.config.scanRanges)
  const accepted: string[] = []
  for (const range of ranges) {
    if (state.config.scanRanges.length >= 20) break
    if (existing.has(range.cidr)) continue
    if (state.config.ignoredScanRanges[range.cidr]) continue
    state.config.scanRanges.push(range.cidr)
    state.config.scanRangeSources[range.cidr] = {
      source: 'remote',
      sourceNodeId: source.nodeId,
      sourceName: source.name,
      addedAt: range.addedAt > 0 ? range.addedAt : Date.now()
    }
    existing.add(range.cidr)
    accepted.push(range.cidr)
  }
  if (accepted.length > 0) atomicWriteJson(state.configPath, state.config)
  return accepted
}

export function markScanRangeAutoScanned(state: AppState, cidr: string, at = Date.now()): void {
  if (!state.config.scanRangeSources) state.config.scanRangeSources = {}
  const record = state.config.scanRangeSources[cidr]
  if (!record) return
  record.lastAutoScanAt = at
  atomicWriteJson(state.configPath, state.config)
}

export function loadAppState(
  dataDir: string,
  appVersion: string,
  tcpPort = DEFAULT_TCP_PORT,
  udpPort = DEFAULT_UDP_PORT
): AppState {
  const identityPath = join(dataDir, 'identity.json')
  const configPath = join(dataDir, 'config.json')

  let identity = readJson<IdentityFile>(identityPath)
  if (!identity || typeof identity.nodeId !== 'string' || identity.nodeId.length === 0) {
    identity = { nodeId: randomUUID(), createdAt: Date.now() }
    atomicWriteJson(identityPath, identity)
  }

  let config = readJson<ConfigFile>(configPath)
  if (!config || typeof config.nick !== 'string') {
    let nick = '未命名'
    try {
      nick = userInfo().username || nick
    } catch {
      // 某些受限环境拿不到用户名，保持默认
    }
    config = {
      nick,
      company: '',
      dept: '',
      team: '',
      avatar: -1,
      profileRev: 1,
      setupDone: false,
      fileDir: '',
      notifications: true,
      manualPeers: [],
      scanRanges: [],
      scanRangeSources: {},
      ignoredScanRanges: {},
      udpPort,
      tcpPort,
      hideOnCapture: true,
      autoLaunch: true,
      closeToTray: true,
      theme: 'light',
      fontScale: 100,
      showMessagePreview: true,
      sound: 'none',
      sendKey: 'enter',
      captureShortcut: 'CommandOrControl+Alt+A',
      showHideShortcut: 'CommandOrControl+Alt+P'
    }
    atomicWriteJson(configPath, config)
  }
  // 老配置文件升级：补默认字段
  config.avatar =
    typeof config.avatar === 'number' &&
    Number.isInteger(config.avatar) &&
    config.avatar >= -1 &&
    config.avatar <= 999
      ? config.avatar
      : -1
  config.setupDone = config.setupDone === true
  config.fileDir = typeof config.fileDir === 'string' ? config.fileDir : ''
  config.notifications = config.notifications !== false
  config.manualPeers = Array.isArray(config.manualPeers)
    ? config.manualPeers.filter((s): s is string => typeof s === 'string')
    : []
  config.scanRanges = Array.isArray(config.scanRanges)
    ? [
        ...new Set(
          config.scanRanges
            .filter((s): s is string => typeof s === 'string')
            .map((s) => normalizeConfigCidr(s))
            .filter((s): s is string => typeof s === 'string')
        )
      ]
    : []
  config.scanRangeSources =
    config.scanRangeSources &&
    typeof config.scanRangeSources === 'object' &&
    !Array.isArray(config.scanRangeSources)
      ? Object.fromEntries(
          Object.entries(config.scanRangeSources)
            .map(
              ([cidr, record]) =>
                [normalizeConfigCidr(cidr), cleanScanRangeSourceRecord(record)] as const
            )
            .filter(
              (entry): entry is readonly [string, ScanRangeSourceRecord] =>
                entry[0] !== null && entry[1] !== null
            )
        )
      : {}
  config.ignoredScanRanges =
    config.ignoredScanRanges &&
    typeof config.ignoredScanRanges === 'object' &&
    !Array.isArray(config.ignoredScanRanges)
      ? Object.fromEntries(
          Object.entries(config.ignoredScanRanges)
            .map(([key, value]) => [normalizeConfigCidr(key), value] as const)
            .filter(
              (entry): entry is readonly [string, number] =>
                entry[0] !== null && typeof entry[1] === 'number'
            )
        )
      : {}
  const now = Date.now()
  for (const cidr of config.scanRanges) {
    if (!config.scanRangeSources[cidr]) {
      config.scanRangeSources[cidr] = { source: 'self', addedAt: now }
    }
  }
  config.udpPort =
    typeof config.udpPort === 'number' &&
    Number.isInteger(config.udpPort) &&
    config.udpPort >= 1 &&
    config.udpPort <= 65535
      ? config.udpPort
      : DEFAULT_UDP_PORT
  config.tcpPort =
    typeof config.tcpPort === 'number' &&
    Number.isInteger(config.tcpPort) &&
    config.tcpPort >= 1 &&
    config.tcpPort <= 65535
      ? config.tcpPort
      : DEFAULT_TCP_PORT
  config.hideOnCapture = config.hideOnCapture !== false
  config.autoLaunch = config.autoLaunch !== false
  config.closeToTray = config.closeToTray !== false
  config.theme = config.theme === 'dark' ? 'dark' : 'light'
  config.fontScale = config.fontScale === 110 || config.fontScale === 125 ? config.fontScale : 100
  config.showMessagePreview = config.showMessagePreview !== false
  config.sound =
    config.sound === 'drop' || config.sound === 'wood' || config.sound === 'ding'
      ? config.sound
      : 'none'
  config.sendKey = config.sendKey === 'ctrlEnter' ? 'ctrlEnter' : 'enter'
  config.captureShortcut =
    typeof config.captureShortcut === 'string'
      ? config.captureShortcut
      : 'CommandOrControl+Alt+A'
  config.showHideShortcut =
    typeof config.showHideShortcut === 'string'
      ? config.showHideShortcut
      : 'CommandOrControl+Alt+P'

  const profile: Profile = {
    nodeId: identity.nodeId,
    nick: config.nick,
    company: config.company,
    dept: config.dept,
    team: config.team,
    avatar: config.avatar,
    profileRev: config.profileRev,
    host: hostname(),
    platform: detectPlatform(),
    tcpPort,
    ver: appVersion,
    caps: []
  }

  return { nodeId: identity.nodeId, profile, config, configPath }
}
