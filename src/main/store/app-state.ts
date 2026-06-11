import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson } from '../util/atomic-write'
import { DEFAULT_TCP_PORT, type Platform, type Profile } from '../../shared/protocol'

// v0.1 的最小本地状态：identity.json（节点身份，永不变）+ config.json（用户资料）。
// 完整设置系统（settings service）后续落地，读写约定不变。

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
    patch.team !== config.team

  config.nick = patch.nick
  config.company = patch.company
  config.dept = patch.dept
  config.team = patch.team
  config.fileDir = patch.fileDir
  config.setupDone = true
  if (profileChanged) config.profileRev += 1
  atomicWriteJson(state.configPath, config)

  profile.nick = config.nick
  profile.company = config.company
  profile.dept = config.dept
  profile.team = config.team
  profile.profileRev = config.profileRev
}

/** 保存应用级设置（通知开关 / 手动节点 / 扫描网段），与资料保存互不影响 */
export function saveAppSettings(
  state: AppState,
  patch: Partial<Pick<ConfigFile, 'notifications' | 'manualPeers' | 'scanRanges'>>
): void {
  if (patch.notifications !== undefined) state.config.notifications = patch.notifications
  if (patch.manualPeers !== undefined) state.config.manualPeers = patch.manualPeers
  if (patch.scanRanges !== undefined) state.config.scanRanges = patch.scanRanges
  atomicWriteJson(state.configPath, state.config)
}

export function loadAppState(dataDir: string, appVersion: string, tcpPort = DEFAULT_TCP_PORT): AppState {
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
      scanRanges: []
    }
    atomicWriteJson(configPath, config)
  }
  // 老配置文件升级：补默认字段
  config.setupDone = config.setupDone === true
  config.fileDir = typeof config.fileDir === 'string' ? config.fileDir : ''
  config.notifications = config.notifications !== false
  config.manualPeers = Array.isArray(config.manualPeers)
    ? config.manualPeers.filter((s): s is string => typeof s === 'string')
    : []
  config.scanRanges = Array.isArray(config.scanRanges)
    ? config.scanRanges.filter((s): s is string => typeof s === 'string')
    : []

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
