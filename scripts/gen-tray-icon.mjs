// 生成托盘图标（32×32）并直接写入 src/main/windows/tray-icon.ts —— 内嵌 base64，
// 不走文件路径，开发/打包/asar 场景行为一致。改图标：改本脚本后重新运行。
// 两个版本（决议 #58）：
//   mono  —— macOS 菜单栏 template（#111，按 alpha 自动着色，约 82% 内容区）
//   color —— Windows / Linux 彩色填充版（茶青圆角块 + 白色茶杯线条）
// 纯 Node 实现 PNG 编码（IHDR/IDAT/IEND + zlib），不引依赖。
// 用法：node scripts/gen-tray-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 32
const VIEWBOX = 64
const MARK_CENTER = 32
const MONO_COLOR = [0x11, 0x11, 0x11]
const PRIMARY = [0x3d, 0x8b, 0x6b] // 茶青（tokens.css --primary）
const WHITE = [0xff, 0xff, 0xff]

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v))
const aa = 1.25

function strokeAlpha(distance) {
  return clamp(0.5 - distance / aa)
}

function scaledMarkCoord(v, markScale) {
  return MARK_CENTER + (v - MARK_CENTER) / markScale
}

function segmentDistance(px, py, ax, ay, bx, by) {
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

function capsule(px, py, ax, ay, bx, by, width) {
  return segmentDistance(px, py, ax, ay, bx, by) - width / 2
}

function roundedRectSdf(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - w / 2 + r
  const qy = Math.abs(py - (y + h / 2)) - h / 2 + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function roundedRectStroke(px, py, x, y, w, h, r, width) {
  return Math.abs(roundedRectSdf(px, py, x, y, w, h, r)) - width / 2
}

function handleStroke(px, py) {
  const dx = (px - 50.5) / 7.3
  const dy = (py - 38) / 7.2
  const angle = Math.atan2(dy, dx)
  if (Math.abs(angle) > 1.65) return 99
  return Math.abs(Math.sqrt(dx * dx + dy * dy) - 1) * 7.2 - 3.8 / 2
}

/** 茶杯线条（杯身气泡轮廓 + 杯把 + 杯口线 + 两缕蒸汽），坐标系 64 viewbox */
function markAlpha(px, py) {
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

function emptyRaw() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
  for (let y = 0; y < SIZE; y++) raw[y * (1 + SIZE * 4)] = 0 // filter: None
  return raw
}

function paintOver(raw, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || alpha <= 0) return
  const offset = y * (1 + SIZE * 4) + 1 + x * 4
  const dstAlpha = raw[offset + 3] / 255
  const srcAlpha = alpha / 255
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
  if (outAlpha <= 0) return
  raw[offset] = Math.round((color[0] * srcAlpha + raw[offset] * dstAlpha * (1 - srcAlpha)) / outAlpha)
  raw[offset + 1] = Math.round(
    (color[1] * srcAlpha + raw[offset + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha
  )
  raw[offset + 2] = Math.round(
    (color[2] * srcAlpha + raw[offset + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha
  )
  raw[offset + 3] = Math.round(outAlpha * 255)
}

/** mono：透明底 + #111 杯子线条（macOS template，82% 内容区） */
function renderMono() {
  const raw = emptyRaw()
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = scaledMarkCoord(((x + 0.5) / SIZE) * VIEWBOX, 0.82)
      const py = scaledMarkCoord(((y + 0.5) / SIZE) * VIEWBOX, 0.82)
      paintOver(raw, x, y, MONO_COLOR, Math.round(markAlpha(px, py) * 255))
    }
  }
  return raw
}

/** color：茶青圆角块满幅 + 白色杯子线条（Windows / Linux 托盘） */
function renderColor() {
  const raw = emptyRaw()
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = ((x + 0.5) / SIZE) * VIEWBOX
      const py = ((y + 0.5) / SIZE) * VIEWBOX
      const block = clamp(0.5 - roundedRectSdf(px, py, 2, 2, 60, 60, 14) / aa)
      paintOver(raw, x, y, PRIMARY, Math.round(block * 255))
      const mx = scaledMarkCoord(px, 0.78)
      const my = scaledMarkCoord(py, 0.78)
      paintOver(raw, x, y, WHITE, Math.round(markAlpha(mx, my) * 255))
    }
  }
  return raw
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const monoUrl = `data:image/png;base64,${encodePng(renderMono()).toString('base64')}`
const colorUrl = `data:image/png;base64,${encodePng(renderColor()).toString('base64')}`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'src/main/windows/tray-icon.ts')
writeFileSync(
  outFile,
  `// 托盘图标（32×32，决议 #58）。由 scripts/gen-tray-icon.mjs 生成后内嵌 —— 不走文件路径，
// 开发/打包/asar 场景行为一致。改图标：改脚本重新生成，不要手改本文件。
/** macOS 菜单栏单色 template（按 alpha 自动着色） */
export const TRAY_ICON_MONO_DATAURL =
  '${monoUrl}'
/** Windows / Linux 彩色填充版（茶青圆角块 + 白杯） */
export const TRAY_ICON_COLOR_DATAURL =
  '${colorUrl}'
`
)
console.log(`已写入 ${outFile}`)
