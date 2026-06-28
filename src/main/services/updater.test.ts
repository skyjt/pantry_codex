import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { findLocalUpdatePackage, pickUpdateSource, shouldServeUpdateRequest } from './updater'
import type { SourceCandidate } from './updater'
import type { Profile } from '../../shared/protocol'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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

describe('自更新请求复核与本地包查找', () => {
  it('只响应同平台、在线、且本机版本更高的请求方', () => {
    const self = { version: '0.28.0', platform: 'linux' as const }
    const requester = { profile: prof({ platform: 'linux', ver: '0.27.5' }), online: true }
    expect(shouldServeUpdateRequest(self, requester, 'linux')).toBe(true)
    expect(shouldServeUpdateRequest(self, { ...requester, online: false }, 'linux')).toBe(false)
    expect(shouldServeUpdateRequest(self, requester, 'win')).toBe(false)
    expect(
      shouldServeUpdateRequest(self, { profile: prof({ platform: 'win', ver: '0.27.5' }), online: true }, 'linux')
    ).toBe(false)
    expect(
      shouldServeUpdateRequest(self, { profile: prof({ platform: 'linux', ver: '0.28.0' }), online: true }, 'linux')
    ).toBe(false)
  })

  it('按平台与版本从候选目录查找安装包', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-update-pkg-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, 'Teahouse-0.28.0-linux-x86_64.AppImage'), 'appimage')
    writeFileSync(join(dir, 'Teahouse-0.28.0-linux-amd64.deb'), 'deb')
    writeFileSync(join(dir, 'Teahouse-0.28.0-linux-arm64.deb'), 'arm64-deb')
    writeFileSync(join(dir, 'Teahouse-0.28.0-win-x64-portable.exe'), 'portable')
    writeFileSync(join(dir, 'Teahouse-0.27.9-win-x64-setup.exe'), 'old')
    writeFileSync(join(dir, 'Teahouse-0.28.0-win-x64-setup.exe'), 'exe')

    expect(findLocalUpdatePackage({ dirs: [dir], version: '0.28.0', platform: 'linux', arch: 'x64' })).toBe(
      join(dir, 'Teahouse-0.28.0-linux-amd64.deb')
    )
    expect(findLocalUpdatePackage({ dirs: [dir], version: '0.28.0', platform: 'linux', arch: 'arm64' })).toBe(
      join(dir, 'Teahouse-0.28.0-linux-arm64.deb')
    )
    expect(findLocalUpdatePackage({ dirs: [dir], version: '0.28.0', platform: 'win', arch: 'x64' })).toBe(
      join(dir, 'Teahouse-0.28.0-win-x64-setup.exe')
    )
    expect(findLocalUpdatePackage({ dirs: [dir], version: '0.28.0', platform: 'mac' })).toBeNull()
    expect(findLocalUpdatePackage({ dirs: [dir], version: '0.29.0', platform: 'linux', arch: 'x64' })).toBeNull()
  })
})
