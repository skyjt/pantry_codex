import type { TcpFrame } from '../../shared/protocol'

// TCP 帧编解码（protocol §8）：4 字节大端长度前缀 + UTF-8 JSON 控制帧；
// pull-ok 之后切换 raw 模式直收 len 字节裸流（零拷贝直传，不做 base64）。

const MAX_FRAME = 64 * 1024

export function encodeFrame(frame: TcpFrame): Buffer {
  const body = Buffer.from(JSON.stringify(frame), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(body.length)
  return Buffer.concat([head, body])
}

/**
 * 流式帧读取器：frame 模式解析控制帧；expectRaw(n) 后转 raw 模式，
 * 把接下来的 n 字节按到达顺序回调（之后自动切回 frame 模式）。
 */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0)
  private rawLeft = 0

  constructor(
    private readonly onFrame: (frame: TcpFrame) => void,
    private readonly onRaw: (chunk: Buffer) => void,
    private readonly onError: (reason: string) => void
  ) {}

  expectRaw(bytes: number): void {
    this.rawLeft = bytes
    this.drain()
  }

  feed(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    this.drain()
  }

  private drain(): void {
    for (;;) {
      if (this.rawLeft > 0) {
        if (this.buf.length === 0) return
        const take = Math.min(this.rawLeft, this.buf.length)
        const piece = this.buf.subarray(0, take)
        this.buf = this.buf.subarray(take)
        this.rawLeft -= take
        this.onRaw(piece)
        continue
      }
      if (this.buf.length < 4) return
      const len = this.buf.readUInt32BE(0)
      if (len === 0 || len > MAX_FRAME) {
        this.onError('bad-frame-length')
        return
      }
      if (this.buf.length < 4 + len) return
      const body = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      let frame: TcpFrame
      try {
        frame = JSON.parse(body.toString('utf8')) as TcpFrame
      } catch {
        this.onError('bad-frame-json')
        return
      }
      if (typeof frame !== 'object' || frame === null || typeof frame.type !== 'string') {
        this.onError('bad-frame-shape')
        return
      }
      this.onFrame(frame)
    }
  }
}
