// 生成托盘图标（32×32 茶青圆点）并输出 base64 —— 产物内嵌到 src/main/windows/tray-icon.ts。
// 纯 Node 实现 PNG 编码（IHDR/IDAT/IEND + zlib），不引依赖。用法：node scripts/gen-tray-icon.mjs
import { deflateSync } from 'node:zlib'

const SIZE = 32
const R = 13.5
const COLOR = [0x3d, 0x8b, 0x6b] // 茶青 #3D8B6B

// RGBA 像素：圆形 + 1px 软边抗锯齿
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0 // filter: None
  for (let x = 0; x < SIZE; x++) {
    const dx = x + 0.5 - SIZE / 2
    const dy = y + 0.5 - SIZE / 2
    const d = Math.sqrt(dx * dx + dy * dy)
    const alpha = Math.max(0, Math.min(1, R + 0.5 - d))
    const offset = y * (1 + SIZE * 4) + 1 + x * 4
    raw[offset] = COLOR[0]
    raw[offset + 1] = COLOR[1]
    raw[offset + 2] = COLOR[2]
    raw[offset + 3] = Math.round(alpha * 255)
  }
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

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

console.log(png.toString('base64'))
