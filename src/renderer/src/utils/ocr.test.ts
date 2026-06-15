import { describe, expect, it } from 'vitest'
import { getSelectedOcrText, isAutoOcrCandidate, type OcrToken } from './ocr'

function token(id: string, text: string, lineIndex: number, tokenIndex: number): OcrToken {
  return {
    id,
    text,
    lineIndex,
    tokenIndex,
    confidence: 90,
    bbox: { x0: tokenIndex * 10, y0: lineIndex * 10, x1: tokenIndex * 10 + 8, y1: lineIndex * 10 + 8 }
  }
}

describe('ocr utils', () => {
  it('按行与 token 顺序复制，英文补空格，中文不补空格', () => {
    const tokens = [
      token('b', 'OCR', 0, 1),
      token('d', '话', 1, 1),
      token('a', 'PANTRY', 0, 0),
      token('c', '茶', 1, 0)
    ]

    expect(getSelectedOcrText(tokens, new Set(['a', 'b', 'c', 'd']))).toBe('PANTRY OCR\n茶话')
  })

  it('小图片自动 OCR，大图片或大字节走手动', () => {
    expect(isAutoOcrCandidate(1200, 900, 2 * 1024 * 1024)).toBe(true)
    expect(isAutoOcrCandidate(2000, 1600, 2 * 1024 * 1024)).toBe(false)
    expect(isAutoOcrCandidate(1200, 900, 5 * 1024 * 1024)).toBe(false)
  })
})
