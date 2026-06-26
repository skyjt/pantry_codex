import { describe, it, expect } from 'vitest'
import { pickUpdateSource } from './updater'
import type { SourceCandidate } from './updater'
import type { Profile } from '../../shared/protocol'

function prof(over: Partial<Profile>): Profile {
  return {
    nodeId: 'n',
    nick: '某人',
    company: '',
    dept: '',
    team: '',
    avatar: -1,
    profileRev: 1,
    host: 'h',
    platform: 'win',
    tcpPort: 17879,
    ver: '0.26.5',
    caps: [],
    ...over
  }
}

function cand(over: Partial<Profile>, online = true, displayName = ''): SourceCandidate {
  return { profile: prof(over), online, displayName }
}

describe('pickUpdateSource', () => {
  const self = { version: '0.26.5', platform: 'win' as const }

  it('挑同平台 + 更高版本 + upd1 + 在线', () => {
    const src = pickUpdateSource(self, [cand({ nodeId: 'a', ver: '0.27.0', caps: ['upd1'] })])
    expect(src?.nodeId).toBe('a')
    expect(src?.version).toBe('0.27.0')
  })

  it('跳过：同/低版本、无 upd1、离线、异平台', () => {
    expect(pickUpdateSource(self, [cand({ ver: '0.26.5', caps: ['upd1'] })])).toBeNull() // 同版本
    expect(pickUpdateSource(self, [cand({ ver: '0.26.4', caps: ['upd1'] })])).toBeNull() // 更低
    expect(pickUpdateSource(self, [cand({ ver: '0.27.0', caps: [] })])).toBeNull() // 无 upd1
    expect(pickUpdateSource(self, [cand({ ver: '0.27.0', caps: ['upd1'] }, false)])).toBeNull() // 离线
    expect(pickUpdateSource(self, [cand({ ver: '0.27.0', caps: ['upd1'], platform: 'linux' })])).toBeNull() // 异平台
  })

  it('多候选取最高版本', () => {
    const src = pickUpdateSource(self, [
      cand({ nodeId: 'a', ver: '0.27.0', caps: ['upd1'] }),
      cand({ nodeId: 'b', ver: '0.28.1', caps: ['upd1'] }),
      cand({ nodeId: 'c', ver: '0.27.5', caps: ['upd1'] })
    ])
    expect(src?.nodeId).toBe('b')
    expect(src?.version).toBe('0.28.1')
  })

  it('显示名优先 displayName、回退 nick', () => {
    expect(
      pickUpdateSource(self, [cand({ nodeId: 'a', ver: '0.27.0', caps: ['upd1'], nick: '张三' }, true, '备注名')])
        ?.fromName
    ).toBe('备注名')
    expect(
      pickUpdateSource(self, [cand({ nodeId: 'a', ver: '0.27.0', caps: ['upd1'], nick: '张三' }, true, '')])?.fromName
    ).toBe('张三')
  })
})
