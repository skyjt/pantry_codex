import { describe, it, expect } from 'vitest'
import { compareSemver, isNewer } from './semver'

describe('compareSemver', () => {
  it('主/次/补丁逐级比较', () => {
    expect(compareSemver('0.27.0', '0.26.5')).toBe(1)
    expect(compareSemver('0.26.5', '0.27.0')).toBe(-1)
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1)
    expect(compareSemver('0.26.5', '0.26.5')).toBe(0)
  })

  it('按数值而非字典序', () => {
    expect(compareSemver('0.26.10', '0.26.9')).toBe(1)
    expect(compareSemver('0.2.0', '0.10.0')).toBe(-1)
  })

  it('非法/缺段按 0 处理', () => {
    expect(compareSemver('0.27', '0.27.0')).toBe(0)
    expect(compareSemver('', '0.0.0')).toBe(0)
    expect(compareSemver('abc', '0.0.1')).toBe(-1)
  })

  it('isNewer 严格大于', () => {
    expect(isNewer('0.27.0', '0.26.5')).toBe(true)
    expect(isNewer('0.26.5', '0.26.5')).toBe(false)
    expect(isNewer('0.26.4', '0.26.5')).toBe(false)
  })
})
