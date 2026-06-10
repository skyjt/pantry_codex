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

interface ConfigFile {
  nick: string
  company: string
  dept: string
  team: string
  avatar: number
  profileRev: number
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
}

export function loadAppState(dataDir: string, appVersion: string): AppState {
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
    config = { nick, company: '', dept: '', team: '', avatar: -1, profileRev: 1 }
    atomicWriteJson(configPath, config)
  }

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
    tcpPort: DEFAULT_TCP_PORT,
    ver: appVersion,
    caps: []
  }

  return { nodeId: identity.nodeId, profile }
}
