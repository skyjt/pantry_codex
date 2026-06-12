import { describe, expect, it } from 'vitest'
import { avatarEmojiIndex, avatarText } from './avatar'
import { compatEmojiItem, splitEmojiText } from './compat-emoji'

describe('compat emoji rendering helpers', () => {
  it('识别多码点 emoji，并保留普通文本顺序', () => {
    expect(splitEmojiText('收到👍，安排❤️ OK')).toEqual([
      { text: '收到', emoji: false },
      { text: '👍', emoji: true },
      { text: '，安排', emoji: false },
      { text: '❤️', emoji: true },
      { text: ' OK', emoji: false }
    ])
    expect(splitEmojiText('✌️完成')[0]).toEqual({ text: '✌️', emoji: true })
  })

  it('内置 emoji 有本地渲染元数据', () => {
    expect(compatEmojiItem('👍')).toMatchObject({ label: '赞', mark: '赞' })
    expect(compatEmojiItem('不存在')).toBeUndefined()
  })

  it('头像文本兜底不再返回系统 emoji 字符', () => {
    expect(avatarText(0, '张三')).toBe('张')
    expect(avatarText(-1, '')).toBe('茶')
    expect(avatarEmojiIndex(199)).toBe(19)
  })
})
