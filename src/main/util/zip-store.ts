import { readFileSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(date = new Date()): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export function writeStoreZip(path: string, entries: ZipEntry[]): void {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const stamp = dosTime()

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 file name
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, entry.data)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(stamp.time, 12)
    dir.writeUInt16LE(stamp.day, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(entry.data.length, 20)
    dir.writeUInt32LE(entry.data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34)
    dir.writeUInt16LE(0, 36)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)
    offset += local.length + name.length + entry.data.length
  }

  const centralStart = offset
  const centralSize = central.reduce((sum, c) => sum + c.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  writeFileSync(path, Buffer.concat([...chunks, ...central, eocd]))
}

export function readZip(path: string): Map<string, Buffer> {
  const buf = readFileSync(path)
  const eocd = findSignature(buf, 0x06054b50, Math.max(0, buf.length - 66000))
  if (eocd < 0) throw new Error('bad-zip:eocd')
  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('bad-zip:central')
    const method = buf.readUInt16LE(ptr + 10)
    const compressedSize = buf.readUInt32LE(ptr + 20)
    const size = buf.readUInt32LE(ptr + 24)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8')
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad-zip:local')
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const compressed = buf.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) out.set(name, Buffer.from(compressed))
    else if (method === 8) out.set(name, inflateRawSync(compressed))
    else throw new Error('bad-zip:method')
    if (out.get(name)?.length !== size) throw new Error('bad-zip:size')
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function findSignature(buf: Buffer, sig: number, start: number): number {
  for (let i = buf.length - 4; i >= start; i--) {
    if (buf.readUInt32LE(i) === sig) return i
  }
  return -1
}
