import { describe, expect, it } from 'vitest'
import { sanitizeRelPath } from './sanitize'

describe('sanitizeRelPath（路径穿越防护红线）', () => {
  it('正常相对路径放行（含中文/空格/连字符）', () => {
    expect(sanitizeRelPath('设计稿 final-v2.zip')).toBe('设计稿 final-v2.zip')
    expect(sanitizeRelPath('项目/子 目录/文件-1.txt')).toBe('项目/子 目录/文件-1.txt')
    expect(sanitizeRelPath('a\\b\\c.txt')).toBe('a/b/c.txt') // 反斜杠归一
  })

  it('路径穿越一律拒绝', () => {
    expect(sanitizeRelPath('../etc/passwd')).toBeNull()
    expect(sanitizeRelPath('a/../../b')).toBeNull()
    expect(sanitizeRelPath('..')).toBeNull()
    expect(sanitizeRelPath('a/./b')).toBeNull()
  })

  it('盘符与保留字符', () => {
    expect(sanitizeRelPath('C:/windows/system32')).toBeNull()
    expect(sanitizeRelPath('a<b>c.txt')).toBe('abc.txt') // 保留字符剥离
    expect(sanitizeRelPath('???')).toBeNull() // 剥完为空 → 拒绝
  })

  it('长度限制', () => {
    expect(sanitizeRelPath('x'.repeat(513))).toBeNull()
    expect(sanitizeRelPath('')).toBeNull()
  })
})
