export interface CompatEmojiItem {
  char: string
  label: string
  kind: string
  mark: string
}

export const COMPAT_EMOJIS: CompatEmojiItem[] = [
  { char: '😀', label: '开心', kind: 'face-smile', mark: '' },
  { char: '😄', label: '大笑', kind: 'face-grin', mark: '' },
  { char: '😁', label: '露齿笑', kind: 'face-grin', mark: '' },
  { char: '😂', label: '笑哭', kind: 'face-joy', mark: '' },
  { char: '🤣', label: '笑翻', kind: 'face-joy', mark: '' },
  { char: '😊', label: '微笑', kind: 'face-soft', mark: '' },
  { char: '😉', label: '眨眼', kind: 'face-wink', mark: '' },
  { char: '😍', label: '喜欢', kind: 'face-love', mark: '' },
  { char: '😘', label: '飞吻', kind: 'face-kiss', mark: '' },
  { char: '😜', label: '调皮', kind: 'face-play', mark: '' },
  { char: '🤔', label: '思考', kind: 'face-think', mark: '?' },
  { char: '🤗', label: '抱抱', kind: 'face-hug', mark: '' },
  { char: '😎', label: '酷', kind: 'face-cool', mark: '' },
  { char: '🙄', label: '无语', kind: 'face-roll', mark: '' },
  { char: '😤', label: '生气', kind: 'face-angry', mark: '' },
  { char: '😭', label: '大哭', kind: 'face-cry', mark: '' },
  { char: '😱', label: '惊讶', kind: 'face-shock', mark: '!' },
  { char: '😴', label: '睡觉', kind: 'face-sleep', mark: 'Z' },
  { char: '🤤', label: '馋', kind: 'face-drool', mark: '' },
  { char: '😷', label: '口罩', kind: 'face-mask', mark: '' },
  { char: '🤝', label: '握手', kind: 'badge', mark: '握' },
  { char: '👍', label: '赞', kind: 'badge', mark: '赞' },
  { char: '👎', label: '不赞成', kind: 'badge', mark: '踩' },
  { char: '👌', label: 'OK', kind: 'badge', mark: 'OK' },
  { char: '✌️', label: '胜利', kind: 'badge', mark: 'V' },
  { char: '🤞', label: '好运', kind: 'badge', mark: '运' },
  { char: '👏', label: '鼓掌', kind: 'badge', mark: '拍' },
  { char: '🙏', label: '拜托', kind: 'badge', mark: '拜' },
  { char: '💪', label: '加油', kind: 'badge', mark: '力' },
  { char: '👀', label: '看看', kind: 'eyes', mark: '' },
  { char: '🤦', label: '扶额', kind: 'badge', mark: '唉' },
  { char: '🤷', label: '摊手', kind: 'badge', mark: '？' },
  { char: '🙋', label: '举手', kind: 'badge', mark: '我' },
  { char: '✋', label: '停', kind: 'badge', mark: '停' },
  { char: '👋', label: '挥手', kind: 'badge', mark: '嗨' },
  { char: '❤️', label: '爱心', kind: 'heart', mark: '' },
  { char: '💔', label: '心碎', kind: 'heart-broken', mark: '' },
  { char: '💯', label: '一百分', kind: 'badge', mark: '100' },
  { char: '🔥', label: '火', kind: 'fire', mark: '' },
  { char: '🎉', label: '庆祝', kind: 'party', mark: '' },
  { char: '🎊', label: '彩花', kind: 'party', mark: '' },
  { char: '✨', label: '闪光', kind: 'spark', mark: '' },
  { char: '⭐', label: '星星', kind: 'star', mark: '' },
  { char: '🌟', label: '亮星', kind: 'star', mark: '' },
  { char: '☀️', label: '晴天', kind: 'sun', mark: '' },
  { char: '🌧️', label: '下雨', kind: 'rain', mark: '' },
  { char: '⚡', label: '闪电', kind: 'badge', mark: '电' },
  { char: '❄️', label: '雪', kind: 'badge', mark: '雪' },
  { char: '🌈', label: '彩虹', kind: 'rainbow', mark: '' },
  { char: '🍵', label: '茶', kind: 'drink', mark: '茶' },
  { char: '☕', label: '咖啡', kind: 'drink', mark: '咖' },
  { char: '🍺', label: '啤酒', kind: 'drink', mark: '啤' },
  { char: '🥳', label: '派对', kind: 'face-party', mark: '' },
  { char: '🍰', label: '蛋糕', kind: 'badge', mark: '糕' },
  { char: '🍜', label: '面', kind: 'badge', mark: '面' },
  { char: '🍚', label: '饭', kind: 'badge', mark: '饭' },
  { char: '🍉', label: '西瓜', kind: 'badge', mark: '瓜' },
  { char: '🍎', label: '苹果', kind: 'badge', mark: '果' },
  { char: '🍊', label: '橘子', kind: 'badge', mark: '橘' },
  { char: '⏰', label: '闹钟', kind: 'badge', mark: '钟' },
  { char: '📌', label: '图钉', kind: 'badge', mark: '钉' },
  { char: '📎', label: '回形针', kind: 'badge', mark: '夹' },
  { char: '✅', label: '完成', kind: 'badge', mark: '✓' },
  { char: '❌', label: '错误', kind: 'badge', mark: '×' },
  { char: '⚠️', label: '警告', kind: 'badge', mark: '!' },
  { char: '❓', label: '疑问', kind: 'badge', mark: '?' },
  { char: '❗', label: '提醒', kind: 'badge', mark: '!' },
  { char: '💤', label: '睡眠', kind: 'badge', mark: 'Zz' },
  { char: '🚀', label: '火箭', kind: 'badge', mark: '飞' },
  { char: '🐛', label: '问题', kind: 'badge', mark: '虫' },
  { char: '🔧', label: '工具', kind: 'badge', mark: '修' },
  { char: '💻', label: '电脑', kind: 'badge', mark: 'PC' },
  { char: '📱', label: '手机', kind: 'badge', mark: '机' },
  { char: '📁', label: '文件夹', kind: 'badge', mark: '夹' },
  { char: '📄', label: '文档', kind: 'badge', mark: '文' },
  { char: '✏️', label: '编辑', kind: 'badge', mark: '笔' },
  { char: '🔍', label: '搜索', kind: 'badge', mark: '找' },
  { char: '🔒', label: '锁定', kind: 'badge', mark: '锁' },
  { char: '🆗', label: '可以', kind: 'badge', mark: 'OK' },
  { char: '💡', label: '想法', kind: 'badge', mark: '灯' }
]

const EMOJI_MAP = new Map(COMPAT_EMOJIS.map((item) => [item.char, item]))
const EMOJI_CHARS = [...EMOJI_MAP.keys()].sort((a, b) => b.length - a.length)

export interface EmojiTextPart {
  text: string
  emoji: boolean
}

export function compatEmojiItem(char: string): CompatEmojiItem | undefined {
  return EMOJI_MAP.get(char)
}

export function splitEmojiText(text: string): EmojiTextPart[] {
  const out: EmojiTextPart[] = []
  let i = 0
  while (i < text.length) {
    const emoji = EMOJI_CHARS.find((char) => text.startsWith(char, i))
    if (emoji) {
      out.push({ text: emoji, emoji: true })
      i += emoji.length
      continue
    }
    const next = nextEmojiIndex(text, i + 1)
    out.push({ text: text.slice(i, next), emoji: false })
    i = next
  }
  return out
}

function nextEmojiIndex(text: string, from: number): number {
  let next = text.length
  for (const char of EMOJI_CHARS) {
    const index = text.indexOf(char, from)
    if (index >= 0 && index < next) next = index
  }
  return next
}
