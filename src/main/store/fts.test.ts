import { describe, expect, it } from 'vitest'
import { toFtsQuery, toFtsTokens } from './fts'

describe('fts 中文按字切分', () => {
  it('中文逐字、ASCII 成串、忽略标点', () => {
    expect(toFtsTokens('需求文档v3，发我一下！')).toBe('需 求 文 档 v3 发 我 一 下')
  })

  it('英文小写归一', () => {
    expect(toFtsTokens('Hello 世界 ABC_def')).toBe('hello 世 界 abc_def')
  })

  it('空串与纯标点', () => {
    expect(toFtsTokens('')).toBe('')
    expect(toFtsTokens('！？。')).toBe('')
  })

  it('查询词转短语匹配', () => {
    expect(toFtsQuery('需求文档')).toBe('"需 求 文 档"')
    expect(toFtsQuery('')).toBe('')
    expect(toFtsQuery('a"b')).toBe('"a b"') // 引号被剥除为分隔，防注入 FTS 语法
  })
})
