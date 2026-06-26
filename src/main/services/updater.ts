// 局域网 P2P 自更新编排（决议 #166）。本文件第一阶段只含「发现与择源」纯逻辑：
// 从在线节点里挑出同平台、版本更高、且声明可作更新源（caps upd1）的最佳来源。
// 拉包（第二步）与安装重启（第三步）见 tech-design §12 后续里程碑。
import type { Platform, Profile } from '../../shared/protocol'
import { CAPS } from '../../shared/protocol'
import { compareSemver } from '../util/semver'

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

/**
 * 从候选里挑「同平台、声明可作更新源、版本严格高于本机」的最高版本在线节点。
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
