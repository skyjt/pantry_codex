import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { EventEmitter } from 'node:events'
import type { DoneFrame, Envelope, PullFrame, PullOkFrame, TcpFrame } from '../../shared/protocol'
import { encodeFrame, FrameReader } from './frame'

// 文件传输数据面（protocol §8，拉取式）：
// 发送方被动开 TCP 服务，按 pull 帧供流（边读边算 SHA-256）；
// 接收方主动连接，逐文件 pull → 收裸流 → 校验 → .part 改名落盘。
// 零 Electron 依赖，vitest 直接回环测试。

export interface OutgoingFile {
  fileId: string
  absPath: string
  size: number
}

export interface OutgoingLookup {
  /** 仅 accepted 状态的传输可被拉取；返回 null 拒绝 */
  resolve(transferId: string, fileId: string): OutgoingFile | null
  /** 超长文本 TCP 控制帧入口；返回 true 表示已接收并应 ACK */
  receiveMessage?: (env: Envelope) => boolean
}

/** 发送侧 TCP 服务。事件：'progress'(transferId, bytesDelta)、'served'(transferId) */
export class TransferServer extends EventEmitter {
  private server: Server | null = null

  constructor(
    private readonly port: number,
    private readonly lookup: OutgoingLookup,
    private readonly bindAddress?: string
  ) {
    super()
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.serve(socket))
      server.once('error', reject)
      server.listen(this.port, this.bindAddress, () => {
        server.removeListener('error', reject)
        server.on('error', () => undefined) // 运行期错误不致命
        this.server = server
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
      this.server = null
    })
  }

  private serve(socket: Socket): void {
    socket.setNoDelay(true)
    let busy = false // 同一连接内文件串行（协议约定），防交叉 pull

    const send = (frame: TcpFrame): void => {
      socket.write(encodeFrame(frame))
    }

    const reader = new FrameReader(
      (frame) => {
        if (frame.type === 'finish') {
          this.emit('served', frame.transferId)
          return
        }
        if (frame.type === 'msg') {
          const ok = this.lookup.receiveMessage?.(frame.envelope) ?? false
          if (ok) send({ type: 'msg-ack', ackFor: frame.envelope.id })
          else send({ type: 'err', reason: 'bad-msg' })
          return
        }
        if (frame.type !== 'pull' || busy) {
          if (frame.type === 'pull') send({ type: 'err', reason: 'busy' })
          return
        }
        const pull = frame as PullFrame
        const file = this.lookup.resolve(pull.transferId, pull.fileId)
        if (!file) {
          send({ type: 'err', reason: 'not-found' })
          return
        }
        const offset = Number.isInteger(pull.offset) && pull.offset >= 0 ? pull.offset : 0
        if (offset > file.size) {
          send({ type: 'err', reason: 'bad-offset' })
          return
        }
        busy = true
        const len = file.size - offset
        send({ type: 'pull-ok', fileId: file.fileId, len } satisfies PullOkFrame)

        const hash = createHash('sha256')
        // done 帧携带整文件哈希：续传场景也要全量校验 → 哈希从 0 读，发送从 offset 读
        const hashStream = createReadStream(file.absPath)
        hashStream.on('data', (chunk) => hash.update(chunk))
        hashStream.on('error', () => socket.destroy())
        hashStream.on('end', () => {
          const dataStream =
            len === 0 ? null : createReadStream(file.absPath, { start: offset })
          const finish = (): void => {
            send({ type: 'done', fileId: file.fileId, sha256: hash.digest('hex') } satisfies DoneFrame)
            busy = false
          }
          if (!dataStream) {
            finish()
            return
          }
          dataStream.on('data', (chunk) => {
            this.emit('progress', pull.transferId, chunk.length)
            if (!socket.write(chunk)) {
              dataStream.pause()
              socket.once('drain', () => dataStream.resume())
            }
          })
          dataStream.on('error', () => socket.destroy())
          dataStream.on('end', finish)
        })
      },
      () => socket.destroy(),
      () => socket.destroy()
    )

    socket.on('data', (chunk) => reader.feed(chunk))
    socket.on('error', () => undefined)
  }
}

export interface IncomingFilePlan {
  fileId: string
  /** 已 sanitize 的相对路径（'/' 分隔） */
  relPath: string
  size: number
  isDir?: boolean
}

export interface PullOptions {
  host: string
  port: number
  selfId: string
  transferId: string
  files: IncomingFilePlan[]
  saveDir: string
  onProgress: (bytesDelta: number) => void
  /** 由服务侧设置以支持取消：destroy 当前 socket */
  cancelRef: { canceled: boolean; socket: Socket | null }
}

/** 接收侧：连接发送方逐文件拉取；保留 .part 时可从 offset 断点续传。 */
export function pullTransfer(opts: PullOptions): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const root = pathResolve(opts.saveDir)
    const socket = createConnection({ host: opts.host, port: opts.port })
    opts.cancelRef.socket = socket
    socket.setNoDelay(true)

    const queue = [...opts.files]
    let current: {
      plan: IncomingFilePlan
      partPath: string
      finalPath: string
      stream: ReturnType<typeof createWriteStream>
      hash: ReturnType<typeof createHash>
      left: number
    } | null = null
    let settled = false

    const fail = (reason: string): void => {
      if (settled) return
      settled = true
      if (current) {
        current.stream.destroy()
        if (
          reason === 'canceled' ||
          reason === 'hash-mismatch' ||
          reason === 'size-mismatch' ||
          reason === 'path-escape' ||
          reason === 'part-read-error'
        ) {
          rmSync(current.partPath, { force: true })
        }
      }
      socket.destroy()
      reject(new Error(reason))
    }

    const succeed = (): void => {
      if (settled) return
      settled = true
      socket.end()
      resolvePromise()
    }

    const next = (): void => {
      if (opts.cancelRef.canceled) {
        fail('canceled')
        return
      }
      const plan = queue.shift()
      if (!plan) {
        socket.write(encodeFrame({ type: 'finish', transferId: opts.transferId }))
        succeed()
        return
      }
      const finalPath = join(root, ...plan.relPath.split('/'))
      if (!pathResolve(finalPath).startsWith(root + sep)) {
        fail('path-escape') // sanitize 之外的最后一道闸
        return
      }
      if (plan.isDir) {
        mkdirSync(finalPath, { recursive: true })
        next()
        return
      }
      mkdirSync(dirname(finalPath), { recursive: true })
      const partPath = `${finalPath}.part`
      let offset = 0
      try {
        offset = Math.min(statSync(partPath).size, plan.size)
      } catch {
        offset = 0
      }
      if (offset > 0) opts.onProgress(offset)
      const hash = createHash('sha256')
      const startPull = (): void => {
        current = {
          plan,
          partPath,
          finalPath,
          stream: createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' }),
          hash,
          left: plan.size - offset
        }
        current.stream.on('error', () => fail('write-error'))
        socket.write(
          encodeFrame({
            type: 'pull',
            from: opts.selfId,
            transferId: opts.transferId,
            fileId: plan.fileId,
            offset
          })
        )
      }
      if (offset === 0) {
        startPull()
        return
      }
      const existing = createReadStream(partPath, { start: 0, end: offset - 1 })
      existing.on('data', (chunk) => hash.update(chunk))
      existing.on('error', () => {
        rmSync(partPath, { force: true })
        fail('part-read-error')
      })
      existing.on('end', startPull)
    }

    const reader = new FrameReader(
      (frame) => {
        if (frame.type === 'err') {
          fail(`peer:${frame.reason}`)
          return
        }
        if (frame.type === 'pull-ok' && current) {
          if (frame.len !== current.left) {
            fail('size-mismatch')
            return
          }
          if (frame.len > 0) reader.expectRaw(frame.len)
          return
        }
        if (frame.type === 'done' && current) {
          const item = current
          current = null
          item.stream.end(() => {
            const got = item.hash.digest('hex')
            if (got !== frame.sha256) {
              rmSync(item.partPath, { force: true })
              fail('hash-mismatch')
              return
            }
            // 重名避让（F-FILE-3 不覆盖）：根级避让在服务层，此处兜底逐文件避让
            renameSync(item.partPath, dedupeTargetPath(item.finalPath))
            next()
          })
        }
      },
      (chunk) => {
        if (!current) return
        current.hash.update(chunk)
        current.left -= chunk.length
        current.stream.write(chunk)
        opts.onProgress(chunk.length)
      },
      (reason) => fail(reason)
    )

    socket.on('data', (chunk) => reader.feed(chunk))
    socket.on('error', () => fail('socket-error'))
    socket.on('close', () => fail('closed'))
    socket.on('connect', () => next())
  })
}

/** 发送前对落盘目标做重名避让：name.ext → name(1).ext（F-FILE-3 不覆盖） */
export function dedupeTargetPath(path: string): string {
  try {
    statSync(path)
  } catch {
    return path // 不存在，直接用
  }
  const dir = dirname(path)
  const base = path.slice(dir.length + 1)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, `${stem}(${i})${ext}`)
    try {
      statSync(candidate)
    } catch {
      return candidate
    }
  }
  return join(dir, `${stem}(${Date.now()})${ext}`)
}
