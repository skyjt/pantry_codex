// 局域网 P2P 自更新编排（决议 #166）。
import type { Platform, Profile, RuntimeArch } from '../../shared/protocol'
import { CAPS } from '../../shared/protocol'
import { compareSemver } from '../util/semver'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface UpdateSource {
  nodeId: string
  /** 来源节点展示名（备注优先，其次昵称） */
  fromName: string
  /** 来源节点的应用版本 */
  version: string
  platform: Platform
}

export interface SelfRelease {
  version: string
  platform: Platform
}

/** 择源候选：节点资料 + 在线态 + 展示名（由 main 层从 PeerRegistry 投影）。 */
export interface SourceCandidate {
  profile: Profile
  online: boolean
  displayName: string
}

export interface UpdateRequester {
  profile: Profile
  online: boolean
}

/**
 * 从候选里挑「同平台、声明可作更新源、版本严格高于本机」的最高版本在线节点。
 * 具体安装包架构在 update req / 本地包匹配阶段复核，避免 Linux x64/arm64 混用。
 * 无合适来源返回 null。
 */
export function pickUpdateSource(self: SelfRelease, candidates: SourceCandidate[]): UpdateSource | null {
  let best: UpdateSource | null = null
  for (const c of candidates) {
    if (!c.online) continue
    if (c.profile.platform !== self.platform) continue
    if (!Array.isArray(c.profile.caps) || !c.profile.caps.includes(CAPS.updateSource)) continue
    if (compareSemver(c.profile.ver, self.version) <= 0) continue
    if (best && compareSemver(c.profile.ver, best.version) <= 0) continue
    best = {
      nodeId: c.profile.nodeId,
      fromName: c.displayName || c.profile.nick,
      version: c.profile.ver,
      platform: c.profile.platform
    }
  }
  return best
}

/** A 端收到 B 的 update req 后的最小安全复核：同平台、在线、本机版本更高；安装包查找再按请求架构筛选。 */
export function shouldServeUpdateRequest(
  self: SelfRelease,
  requester: UpdateRequester | null | undefined,
  requestedPlatform: Platform
): boolean {
  if (!requester?.online) return false
  if (requestedPlatform !== self.platform) return false
  if (requester.profile.platform !== self.platform) return false
  return compareSemver(self.version, requester.profile.ver) > 0
}

export function findLocalUpdatePackage(opts: {
  dirs: string[]
  version: string
  platform: Platform
  arch?: RuntimeArch
}): string | null {
  const versionNeedle = opts.version.toLowerCase()
  for (const dir of opts.dirs) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    const matches = names
      .filter((name) => {
        const lower = name.toLowerCase()
        return lower.includes(versionNeedle) && isPackageNameForPlatform(lower, opts.platform, opts.arch)
      })
      .sort()
    for (const name of matches) {
      const path = join(dir, name)
      try {
        const st = statSync(path)
        if (st.isFile() && st.size > 0) return path
      } catch {
        // 忽略扫描期间消失的文件
      }
    }
  }
  return null
}

function isPackageNameForPlatform(lowerName: string, platform: Platform, arch?: RuntimeArch): boolean {
  if (platform === 'win') {
    if (!lowerName.endsWith('.exe') || !lowerName.includes('setup') || lowerName.includes('portable')) {
      return false
    }
    return arch ? lowerName.includes(`-win-${arch}-`) : true
  }
  if (platform === 'linux') {
    if (!lowerName.endsWith('.deb')) return false
    if (!arch) return true
    const debArch = arch === 'x64' ? 'amd64' : 'arm64'
    return lowerName.includes(`-linux-${debArch}.deb`)
  }
  return false
}
