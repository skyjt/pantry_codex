// 输入框 emoji 镜像层的宽度测量（决议 #48 / ui-design v0.34）：
// textarea 里 emoji 字符的实际宽度由系统字体决定（mac 彩色 emoji、Win7 缺字方框各不相同），
// 镜像层若用固定 em 宽度占位，每个 emoji 都会累积一点偏差——表情越多光标错位越严重。
// 注意不能用 canvas measureText：Blink 的 canvas 文本与 DOM 排版对 emoji 字体的度量不一致
// （mac 实测 14px 字号下 DOM 排版 emoji 约 14px、measureText 约 18px）。
// 因此用隐藏 DOM 探针按输入框的真实 font 逐字符测量，与 textarea 走同一套文本排版。
// 探针挂在 <html> 下而非 <body>：字体缩放经 body zoom 实现，探针避开 zoom 直接量 CSS px，
// 镜像层设置的 width 与 textarea 同处 zoom 内，两边仍逐字符一致。

export type TextMeasurer = (text: string, font: string) => number

let measurer: TextMeasurer | null = null
const cache = new Map<string, number>()

function domMeasurer(): TextMeasurer {
  let probe: HTMLElement | null = null
  return (text, font) => {
    if (!probe || !probe.isConnected) {
      probe = document.createElement('div')
      probe.style.cssText =
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none'
      document.documentElement.appendChild(probe)
    }
    probe.style.font = font
    probe.textContent = text
    return probe.getBoundingClientRect().width
  }
}

/** 返回 emoji 在指定 font 下的排版宽度（CSS px）；font 为空时返回 0 */
export function emojiAdvanceWidth(emoji: string, font: string): number {
  if (!emoji || !font) return 0
  const key = `${font}|${emoji}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (!measurer) measurer = domMeasurer()
  const width = measurer(emoji, font)
  cache.set(key, width)
  return width
}

/** 从输入框计算样式拼出 font 简写串（探针与 textarea 用同一字体栈渲染） */
export function fontOfStyle(style: CSSStyleDeclaration): string {
  const size = style.fontSize
  const family = style.fontFamily
  if (!size || !family) return ''
  return `${style.fontStyle || 'normal'} ${style.fontWeight || 'normal'} ${size} ${family}`
}

/** 测试注入用：替换测量函数并清空缓存 */
export function setTextMeasurer(next: TextMeasurer | null): void {
  measurer = next
  cache.clear()
}
