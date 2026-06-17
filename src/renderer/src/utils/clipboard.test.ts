import { describe, expect, it } from 'vitest'
import { hasClipboardText, imageMimeFromExt } from './clipboard'

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
})
