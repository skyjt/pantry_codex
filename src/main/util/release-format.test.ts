import { describe, it, expect } from 'vitest'
import { detectReleaseFormat, canServeUpdates } from './release-format'

describe('detectReleaseFormat', () => {
  it('未打包 = dev', () => {
    expect(detectReleaseFormat({ platform: 'win32', isPackaged: false, env: {} })).toBe('dev')
    expect(detectReleaseFormat({ platform: 'linux', isPackaged: false, env: {} })).toBe('dev')
  })

  it('Windows：nsis 安装版 vs portable 绿色版', () => {
    expect(detectReleaseFormat({ platform: 'win32', isPackaged: true, env: {} })).toBe('nsis')
    expect(
      detectReleaseFormat({ platform: 'win32', isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: 'C:/x.exe' } })
    ).toBe('portable')
  })

  it('Linux：deb 安装版 vs AppImage 绿色版', () => {
    expect(detectReleaseFormat({ platform: 'linux', isPackaged: true, env: {} })).toBe('deb')
    expect(
      detectReleaseFormat({ platform: 'linux', isPackaged: true, env: { APPIMAGE: '/x.AppImage' } })
    ).toBe('appimage')
  })

  it('mac = mac', () => {
    expect(detectReleaseFormat({ platform: 'darwin', isPackaged: true, env: {} })).toBe('mac')
  })
})

describe('canServeUpdates', () => {
  it('本期只有 nsis / deb 可作更新源', () => {
    expect(canServeUpdates({ platform: 'win32', isPackaged: true, env: {} })).toBe(true) // nsis
    expect(canServeUpdates({ platform: 'linux', isPackaged: true, env: {} })).toBe(true) // deb
  })

  it('portable / appimage / mac / dev 本期不作源', () => {
    expect(canServeUpdates({ platform: 'win32', isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: 'x' } })).toBe(false)
    expect(canServeUpdates({ platform: 'linux', isPackaged: true, env: { APPIMAGE: 'x' } })).toBe(false)
    expect(canServeUpdates({ platform: 'darwin', isPackaged: true, env: {} })).toBe(false)
    expect(canServeUpdates({ platform: 'win32', isPackaged: false, env: {} })).toBe(false)
  })
})
