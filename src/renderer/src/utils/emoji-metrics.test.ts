import { afterEach, describe, expect, it, vi } from 'vitest'
import { emojiAdvanceWidth, fontOfStyle, setTextMeasurer } from './emoji-metrics'

afterEach(() => setTextMeasurer(null))

describe('emoji 镜像宽度测量', () => {
  it('按 font + emoji 缓存测量结果，不重复测量', () => {
    const measure = vi.fn((text: string) => text.length * 10)
    setTextMeasurer(measure)

    expect(emojiAdvanceWidth('😀', '14px sans')).toBe(20)
    expect(emojiAdvanceWidth('😀', '14px sans')).toBe(20)
    expect(measure).toHaveBeenCalledTimes(1)

    // 不同 font 是不同缓存键（字号缩放后宽度可能不同）
    expect(emojiAdvanceWidth('😀', '18px sans')).toBe(20)
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('font 或 emoji 为空时返回 0，不触发测量', () => {
    const measure = vi.fn(() => 99)
    setTextMeasurer(measure)

    expect(emojiAdvanceWidth('', '14px sans')).toBe(0)
    expect(emojiAdvanceWidth('😀', '')).toBe(0)
    expect(measure).not.toHaveBeenCalled()
  })

  it('从计算样式拼出 measureText 兼容的 font 串', () => {
    const style = {
      fontStyle: 'normal',
      fontWeight: '400',
      fontSize: '14px',
      fontFamily: '"PingFang SC", sans-serif'
    } as CSSStyleDeclaration
    expect(fontOfStyle(style)).toBe('normal 400 14px "PingFang SC", sans-serif')

    const empty = { fontSize: '', fontFamily: '' } as CSSStyleDeclaration
    expect(fontOfStyle(empty)).toBe('')
  })
})
