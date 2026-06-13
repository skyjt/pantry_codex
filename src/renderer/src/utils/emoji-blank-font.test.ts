import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import opentype from 'opentype.js'
import { COMPAT_EMOJIS } from './compat-emoji'

// 等宽空白字形字体（决议 #56）：扩充 COMPAT_EMOJIS 后必须重跑
// scripts/gen-emoji-blank-font.mjs —— 本测试防"加表情忘更新字体"。

const fontPath = fileURLToPath(new URL('../assets/fonts/pantry-emoji-blank.ttf', import.meta.url))
const raw = readFileSync(fontPath)
const font = opentype.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))

const EM_ADVANCE = 1300
const ZERO_WIDTH = [0xfe0f, 0x200d]

describe('PantryEmojiBlank 等宽空白字形字体', () => {
  it('cmap 覆盖内置 emoji 子集的全部码点', () => {
    const missing: string[] = []
    for (const item of COMPAT_EMOJIS) {
      for (const ch of Array.from(item.char)) {
        if (font.charToGlyphIndex(ch) <= 0) missing.push(`${item.char} U+${ch.codePointAt(0)!.toString(16)}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('基础码点 advance 恒为 1.3em，变体选择符/ZWJ 零宽', () => {
    expect(font.unitsPerEm).toBe(1000)
    for (const item of COMPAT_EMOJIS) {
      for (const ch of Array.from(item.char)) {
        const cp = ch.codePointAt(0)!
        const glyph = font.charToGlyph(ch)
        const expected = ZERO_WIDTH.includes(cp) ? 0 : EM_ADVANCE
        expect(glyph.advanceWidth, `U+${cp.toString(16)}`).toBe(expected)
      }
    }
    for (const cp of ZERO_WIDTH) {
      expect(font.charToGlyph(String.fromCodePoint(cp)).advanceWidth).toBe(0)
    }
  })
})
