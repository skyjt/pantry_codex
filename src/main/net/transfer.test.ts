import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TransferServer,
  dedupeTargetPath,
  pullTransfer,
  type IncomingFilePlan,
  type OutgoingFile
} from './transfer'

// 数据面回环测试：真实文件、真实 TCP（127.0.0.1）、真实 SHA-256。
// 控制面（offer/accept）的可靠投递已由 messenger.test 覆盖。

const tmpDirs: string[] = []
const servers: TransferServer[] = []

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pantry-transfer-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let nextPort = 45000 + Math.floor(Math.random() * 1000)

async function startServer(files: Map<string, Map<string, OutgoingFile>>): Promise<number> {
  nextPort += 1
  const server = new TransferServer(
    nextPort,
    {
      resolve: (transferId, fileId) => files.get(transferId)?.get(fileId) ?? null
    },
    '127.0.0.1'
  )
  await server.start()
  servers.push(server)
  return nextPort
}

describe('transfer 数据面回环', () => {
  it('文件夹结构 + 大文件 + 空文件：逐文件拉取、哈希校验、结构还原', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    const big = randomBytes(600 * 1024) // 600KB，跨多个 TCP chunk
    mkdirSync(join(src, 'docs'))
    writeFileSync(join(src, 'big.bin'), big)
    writeFileSync(join(src, 'docs', '说明.txt'), '你好，茶话间')
    writeFileSync(join(src, 'empty.dat'), '')

    const outgoing = new Map<string, OutgoingFile>([
      ['f1', { fileId: 'f1', absPath: join(src, 'big.bin'), size: big.length }],
      ['f2', { fileId: 'f2', absPath: join(src, 'docs', '说明.txt'), size: Buffer.byteLength('你好，茶话间') }],
      ['f3', { fileId: 'f3', absPath: join(src, 'empty.dat'), size: 0 }]
    ])
    const port = await startServer(new Map([['t1', outgoing]]))

    const plans: IncomingFilePlan[] = [
      { fileId: 'f1', relPath: '工程/big.bin', size: big.length },
      { fileId: 'f2', relPath: '工程/docs/说明.txt', size: Buffer.byteLength('你好，茶话间') },
      { fileId: 'f3', relPath: '工程/empty.dat', size: 0 }
    ]
    let bytes = 0
    await pullTransfer({
      host: '127.0.0.1',
      port,
      selfId: 'node-receiver',
      transferId: 't1',
      files: plans,
      saveDir: dst,
      cancelRef: { canceled: false, socket: null },
      onProgress: (d) => {
        bytes += d
      }
    })

    expect(readFileSync(join(dst, '工程', 'big.bin')).equals(big)).toBe(true)
    expect(readFileSync(join(dst, '工程', 'docs', '说明.txt'), 'utf8')).toBe('你好，茶话间')
    expect(readFileSync(join(dst, '工程', 'empty.dat')).length).toBe(0)
    expect(bytes).toBe(big.length + Buffer.byteLength('你好，茶话间'))
  })

  it('未被授权的传输拒绝供流（accepted 才可拉取的最小闸门）', async () => {
    const dst = makeTmp()
    const port = await startServer(new Map()) // 服务器不认识任何传输

    await expect(
      pullTransfer({
        host: '127.0.0.1',
        port,
        selfId: 'node-x',
        transferId: 'unknown',
        files: [{ fileId: 'f', relPath: 'x.bin', size: 10 }],
        saveDir: dst,
        cancelRef: { canceled: false, socket: null },
        onProgress: () => undefined
      })
    ).rejects.toThrow(/peer:not-found/)
  })

  it('已有 .part 时从断点续传并校验整文件哈希', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    const body = randomBytes(256 * 1024)
    const half = Math.floor(body.length / 2)
    writeFileSync(join(src, 'resume.bin'), body)
    writeFileSync(join(dst, 'resume.bin.part'), body.subarray(0, half))
    const outgoing = new Map<string, OutgoingFile>([
      ['f1', { fileId: 'f1', absPath: join(src, 'resume.bin'), size: body.length }]
    ])
    const port = await startServer(new Map([['t-resume', outgoing]]))
    let bytes = 0
    await pullTransfer({
      host: '127.0.0.1',
      port,
      selfId: 'node-receiver',
      transferId: 't-resume',
      files: [{ fileId: 'f1', relPath: 'resume.bin', size: body.length }],
      saveDir: dst,
      cancelRef: { canceled: false, socket: null },
      onProgress: (d) => {
        bytes += d
      }
    })

    expect(readFileSync(join(dst, 'resume.bin')).equals(body)).toBe(true)
    expect(bytes).toBe(body.length)
  })

  it('重名避让：name.ext → name(1).ext', () => {
    const dir = makeTmp()
    writeFileSync(join(dir, 'a.txt'), '1')
    expect(dedupeTargetPath(join(dir, 'a.txt'))).toBe(join(dir, 'a(1).txt'))
    expect(dedupeTargetPath(join(dir, 'b.txt'))).toBe(join(dir, 'b.txt'))
  })
})
