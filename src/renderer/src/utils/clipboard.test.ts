import { describe, expect, it } from 'vitest'
import {
  NATIVE_IMAGE_FALLBACK_SUPPRESS_MS,
  hasClipboardText,
  imageMimeFromExt,
  shouldSuppressNativeImageFallback
} from './clipboard'

describe('clipboard helpers', () => {
  it('优先保留带文本的 emoji / 富文本粘贴', () => {
    expect(hasClipboardText({ getData: (type) => (type === 'text/plain' ? '😀' : '') })).toBe(true)
  })

  it('允许无文本截图继续走图片粘贴', () => {
    expect(hasClipboardText({ getData: () => '' })).toBe(false)
  })

  it('按源文件扩展名生成图片 MIME', () => {
    expect(imageMimeFromExt('.jpg')).toBe('image/jpeg')
    expect(imageMimeFromExt('.webp')).toBe('image/webp')
    expect(imageMimeFromExt('.gif')).toBe('image/gif')
    expect(imageMimeFromExt('.bin')).toBe('image/png')
  })

  it('浏览器 paste 已消费时短时间内抑制原生图片兜底', () => {
    expect(shouldSuppressNativeImageFallback(1_000, 1_000)).toBe(true)
    expect(shouldSuppressNativeImageFallback(1_000, 1_000 + NATIVE_IMAGE_FALLBACK_SUPPRESS_MS - 1)).toBe(true)
    expect(shouldSuppressNativeImageFallback(1_000, 1_000 + NATIVE_IMAGE_FALLBACK_SUPPRESS_MS)).toBe(false)
    expect(shouldSuppressNativeImageFallback(0, 1_000)).toBe(false)
  })
})
