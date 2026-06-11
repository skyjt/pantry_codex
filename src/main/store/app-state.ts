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
  if (patch.notifications !== undefined) state.config.notifications = patch.notifications
  if (patch.manualPeers !== undefined) state.config.manualPeers = patch.manualPeers
  if (patch.scanRanges !== undefined) state.config.scanRanges = patch.scanRanges
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
    ? config.scanRanges.filter((s): s is string => typeof s === 'string')
    : []
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
