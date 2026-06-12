import { describe, expect, it } from 'vitest'
import { AVATAR_EMOJIS, avatarEmojiIndex, avatarText } from './avatar'
import { COMPAT_EMOJIS, compatEmojiItem, splitEmojiText } from './compat-emoji'
import { emojiToTwemojiCode, twemojiUrl } from './twemoji-assets'

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

  it('支持输入框草稿中的换行和多个 emoji 镜像渲染', () => {
    expect(splitEmojiText('第一行😀\n第二行👍 OK')).toEqual([
      { text: '第一行', emoji: false },
      { text: '😀', emoji: true },
      { text: '\n第二行', emoji: false },
      { text: '👍', emoji: true },
      { text: ' OK', emoji: false }
    ])
  })

  it('内置 emoji 有本地渲染元数据', () => {
    expect(compatEmojiItem('👍')).toMatchObject({ label: '赞', mark: '赞' })
    expect(compatEmojiItem('不存在')).toBeUndefined()
  })

  it('映射到本地 Twemoji SVG 资源', () => {
    expect(emojiToTwemojiCode('❤️')).toBe('2764')
    expect(emojiToTwemojiCode('✌️')).toBe('270c')
    expect(twemojiUrl('1f436')).toContain('1f436.svg')
  })

  it('内置头像与表情面板都能找到本地 Twemoji 资源', () => {
    const missing = [...AVATAR_EMOJIS, ...COMPAT_EMOJIS.map((item) => item.char)].filter(
      (emoji) => !twemojiUrl(emojiToTwemojiCode(emoji))
    )

    expect(missing).toEqual([])
  })

  it('头像文本兜底不再返回系统 emoji 字符', () => {
    expect(avatarText(0, '张三')).toBe('张')
    expect(avatarText(-1, '')).toBe('茶')
    expect(avatarEmojiIndex(199)).toBe(19)
  })
})
