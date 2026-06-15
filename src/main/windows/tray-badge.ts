import { deflateSync } from 'node:zlib'
import { TRAY_ICON_COLOR_RGBA_BASE64 } from './tray-icon'

const SIZE = 32
const OVERLAY_SIZE = 16
const BADGE_COLOR = [0xfa, 0x51, 0x51] as const
const WHITE = [0xff, 0xff, 0xff] as const
const aa = 1.25
const BASE_COLOR_RGBA = Buffer.from(TRAY_ICON_COLOR_RGBA_BASE64, 'base64')

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['010', '010', '111', '010', '010']
}

export function unreadBadgeText(count: number): string {
  if (count <= 0) return ''
  if (count > 99) return '99+'
  return String(count)
}

export function trayUnreadToolTip(count: number): string {
  return count > 0 ? `茶话间（${unreadBadgeText(count)} 条未读）` : '茶话间'
}

export function createUnreadTrayIconDataURL(count: number): string {
  return `data:image/png;base64,${encodePng(renderTrayBitmap(count)).toString('base64')}`
}

export function createUnreadOverlayIconDataURL(count: number): string {
  return `data:image/png;base64,${encodePng(renderOverlayBitmap(count)).toString('base64')}`
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v))
}

function fillAlpha(distance: number): number {
  return clamp(0.5 - distance / aa)
}

function roundedRectSdf(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(px - (x + w / 2)) - w / 2 + r
  const qy = Math.abs(py - (y + h / 2)) - h / 2 + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function renderTrayBitmap(count: number): { size: number; raw: Buffer } {
  if (BASE_COLOR_RGBA.length !== SIZE * SIZE * 4) {
    throw new Error(`托盘底图 RGBA 尺寸异常: ${BASE_COLOR_RGBA.length}`)
  }
  const raw = emptyRaw(SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const src = (y * SIZE + x) * 4
      paint(raw, SIZE, x, y, [BASE_COLOR_RGBA[src], BASE_COLOR_RGBA[src + 1], BASE_COLOR_RGBA[src + 2]], BASE_COLOR_RGBA[src + 3])
    }
  }
  drawBadge(raw, SIZE, unreadBadgeText(count))
  return { size: SIZE, raw }
}

function renderOverlayBitmap(count: number): { size: number; raw: Buffer } {
  const raw = emptyRaw(OVERLAY_SIZE)
  drawBadge(raw, OVERLAY_SIZE, unreadBadgeText(count))
  return { size: OVERLAY_SIZE, raw }
}

function emptyRaw(size: number): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) raw[y * (1 + size * 4)] = 0
  return raw
}

function drawBadge(raw: Buffer, size: number, text: string): void {
  if (!text) return
  const isSmall = size <= OVERLAY_SIZE
  const scale = isSmall ? 1 : 2
  const textWidth = text.length * 3 * scale + (text.length - 1) * scale
  const textHeight = 5 * scale
  const badgeW = Math.max(isSmall ? 12 : 14, textWidth + (isSmall ? 4 : 5))
  const badgeH = isSmall ? 11 : 14
  const x = size - badgeW
  const y = 0
  const r = badgeH / 2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const alpha = fillAlpha(roundedRectSdf(px + 0.5, py + 0.5, x, y, badgeW, badgeH, r))
      if (alpha <= 0) continue
      paintOver(raw, size, px, py, BADGE_COLOR, Math.round(alpha * 255))
    }
  }

  const textX = Math.round(x + (badgeW - textWidth) / 2)
  const textY = Math.round(y + (badgeH - textHeight) / 2)
  drawBitmapText(raw, size, text, textX, textY, scale)
}

function drawBitmapText(raw: Buffer, size: number, text: string, x: number, y: number, scale: number): void {
  let cursor = x
  for (const char of text) {
    const glyph = DIGITS[char]
    if (!glyph) continue
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            paintOver(raw, size, cursor + gx * scale + sx, y + gy * scale + sy, WHITE, 255)
          }
        }
      }
    }
    cursor += 4 * scale
  }
}

function paint(raw: Buffer, size: number, x: number, y: number, color: readonly number[], alpha: number): void {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return
  const offset = y * (1 + size * 4) + 1 + x * 4
  raw[offset] = color[0]
  raw[offset + 1] = color[1]
  raw[offset + 2] = color[2]
  raw[offset + 3] = alpha
}

function paintOver(raw: Buffer, size: number, x: number, y: number, color: readonly number[], alpha: number): void {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return
  const offset = y * (1 + size * 4) + 1 + x * 4
  const dstA = raw[offset + 3] / 255
  const srcA = alpha / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  raw[offset] = Math.round((color[0] * srcA + raw[offset] * dstA * (1 - srcA)) / outA)
  raw[offset + 1] = Math.round((color[1] * srcA + raw[offset + 1] * dstA * (1 - srcA)) / outA)
  raw[offset + 2] = Math.round((color[2] * srcA + raw[offset + 2] * dstA * (1 - srcA)) / outA)
  raw[offset + 3] = Math.round(outA * 255)
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(image: { size: number; raw: Buffer }): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.size, 0)
  ihdr.writeUInt32BE(image.size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(image.raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
