import { describe, expect, it } from 'vitest'
import { FrameReader, encodeFrame } from './frame'
import type { TcpFrame } from '../../shared/protocol'

describe('FrameReader', () => {
  it('黏包/半包：多帧一次喂入与逐字节喂入结果一致', () => {
    const frames: TcpFrame[] = [
      { type: 'pull', from: 'n1', transferId: 't1', fileId: 'f1', offset: 0 },
      { type: 'pull-ok', fileId: 'f1', len: 5 },
      { type: 'done', fileId: 'f1', sha256: 'abc' }
    ]
    const wire = Buffer.concat(frames.map(encodeFrame))

    const collect = (chunks: Buffer[]): string[] => {
      const got: string[] = []
      const reader = new FrameReader(
        (f) => got.push(f.type),
        () => undefined,
        (r) => got.push(`err:${r}`)
      )
      for (const c of chunks) reader.feed(c)
      return got
    }

    expect(collect([wire])).toEqual(['pull', 'pull-ok', 'done'])
    const byteByByte = Array.from(wire).map((b) => Buffer.from([b]))
    expect(collect(byteByByte)).toEqual(['pull', 'pull-ok', 'done'])
  })

  it('raw 模式：帧后裸流按量切出，随后自动回到帧模式', () => {
    const raw = Buffer.from('hello-raw-bytes')
    const rawChunks: Buffer[] = []
    const types: string[] = []
    const reader = new FrameReader(
      (f) => {
        types.push(f.type)
        if (f.type === 'pull-ok') reader.expectRaw((f as { len: number }).len)
      },
      (chunk) => rawChunks.push(Buffer.from(chunk)),
      () => types.push('err')
    )
    reader.feed(
      Buffer.concat([
        encodeFrame({ type: 'pull-ok', fileId: 'f', len: raw.length }),
        raw,
        encodeFrame({ type: 'done', fileId: 'f', sha256: 'x' })
      ])
    )
    expect(types).toEqual(['pull-ok', 'done'])
    expect(Buffer.concat(rawChunks).toString()).toBe('hello-raw-bytes')
  })

  it('超长帧拒收', () => {
    const errors: string[] = []
    const reader = new FrameReader(
      () => undefined,
      () => undefined,
      (r) => errors.push(r)
    )
    const head = Buffer.alloc(4)
    head.writeUInt32BE(10 * 1024 * 1024)
    reader.feed(head)
    expect(errors).toEqual(['bad-frame-length'])
  })
})
