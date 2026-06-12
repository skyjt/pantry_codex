import { describe, expect, it } from 'vitest'
import {
  createUnreadOverlayIconDataURL,
  createUnreadTrayIconDataURL,
  trayUnreadToolTip,
  unreadBadgeText
} from './tray-badge'

function decodePng(dataURL: string): Buffer {
  const prefix = 'data:image/png;base64,'
  expect(dataURL.startsWith(prefix)).toBe(true)
  return Buffer.from(dataURL.slice(prefix.length), 'base64')
}

describe('tray unread badge', () => {
  it('格式化未读数字并封顶为 99+', () => {
    expect(unreadBadgeText(0)).toBe('')
    expect(unreadBadgeText(8)).toBe('8')
    expect(unreadBadgeText(42)).toBe('42')
    expect(unreadBadgeText(128)).toBe('99+')
    expect(trayUnreadToolTip(0)).toBe('茶话间')
    expect(trayUnreadToolTip(12)).toBe('茶话间（12 条未读）')
  })

  it('生成可解码的 PNG DataURL', () => {
    const tray = decodePng(createUnreadTrayIconDataURL(7))
    const overlay = decodePng(createUnreadOverlayIconDataURL(7))
    expect(tray.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(overlay.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(tray.length).toBeGreaterThan(100)
    expect(overlay.length).toBeGreaterThan(80)
  })
})
