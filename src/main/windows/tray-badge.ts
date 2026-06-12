import { deflateSync } from 'node:zlib'

const SIZE = 32
const OVERLAY_SIZE = 16
const VIEWBOX = 64
const BASE_COLOR = [0x11, 0x11, 0x11] as const
const BADGE_COLOR = [0xfa, 0x51, 0x51] as const
const WHITE = [0xff, 0xff, 0xff] as const
const aa = 1.25

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

function strokeAlpha(distance: number): number {
  return clamp(0.5 - distance / aa)
}

function fillAlpha(distance: number): number {
  return clamp(0.5 - distance / aa)
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : clamp((wx * vx + wy * vy) / len2)
  const dx = px - (ax + vx * t)
  const dy = py - (ay + vy * t)
  return Math.sqrt(dx * dx + dy * dy)
}

function capsule(px: number, py: number, ax: number, ay: number, bx: number, by: number, width: number): number {
  return segmentDistance(px, py, ax, ay, bx, by) - width / 2
}

function roundedRectSdf(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(px - (x + w / 2)) - w / 2 + r
  const qy = Math.abs(py - (y + h / 2)) - h / 2 + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function roundedRectStroke(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  width: number
): number {
  return Math.abs(roundedRectSdf(px, py, x, y, w, h, r)) - width / 2
}

function handleStroke(px: number, py: number): number {
  const dx = (px - 50.5) / 7.3
  const dy = (py - 38) / 7.2
  const angle = Math.atan2(dy, dx)
  if (Math.abs(angle) > 1.65) return 99
  return Math.abs(Math.sqrt(dx * dx + dy * dy) - 1) * 7.2 - 3.8 / 2
}

function markAlpha(px: number, py: number): number {
  const distances = [
    roundedRectStroke(px, py, 14, 22, 36, 28, 8, 3.8),
    capsule(px, py, 20, 50, 20, 55, 3.8),
    capsule(px, py, 20, 55, 27.5, 50, 3.8),
    handleStroke(px, py),
    capsule(px, py, 24, 31.5, 44, 31.5, 3.8),
    capsule(px, py, 27.5, 15.5, 28.5, 9, 3.8),
    capsule(px, py, 37.5, 15.5, 36.5, 9, 3.8)
  ]
  return Math.max(...distances.map(strokeAlpha))
}

function renderTrayBitmap(count: number): { size: number; raw: Buffer } {
  const raw = emptyRaw(SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = ((x + 0.5) / SIZE) * VIEWBOX
      const py = ((y + 0.5) / SIZE) * VIEWBOX
      const alpha = markAlpha(px, py)
      paint(raw, SIZE, x, y, BASE_COLOR, Math.round(alpha * 255))
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
  const dstAlpha = raw[offset + 3] / 255
  const srcAlpha = alpha / 255
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
  if (outAlpha <= 0) return
  raw[offset] = Math.round((color[0] * srcAlpha + raw[offset] * dstAlpha * (1 - srcAlpha)) / outAlpha)
  raw[offset + 1] = Math.round((color[1] * srcAlpha + raw[offset + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha)
  raw[offset + 2] = Math.round((color[2] * srcAlpha + raw[offset + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha)
  raw[offset + 3] = Math.round(outAlpha * 255)
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf: Buffer): number {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(bitmap: { size: number; raw: Buffer }): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(bitmap.size, 0)
  ihdr.writeUInt32BE(bitmap.size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bitmap.raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
