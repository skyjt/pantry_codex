import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPathInside, PathGrantStore } from './path-policy'

describe('path-policy', () => {
  it('只接受位于根目录内的路径', () => {
    const root = join('/tmp', 'pantry-media')
    expect(isPathInside(join(root, 'a.png'), root)).toBe(true)
    expect(isPathInside(root, root)).toBe(true)
    expect(isPathInside(join(root, '..', 'secret.txt'), root)).toBe(false)
  })

  it('路径授权按窗口隔离、一次性消费并会过期', () => {
    let now = 1000
    const grants = new PathGrantStore(500, () => now)
    const path = join('/tmp', 'a.txt')

    grants.grant(1, [path])
    expect(grants.consume(2, [path])).toBe(false)
    expect(grants.consume(1, [path])).toBe(true)
    expect(grants.consume(1, [path])).toBe(false)

    grants.grant(1, [path])
    now = 1600
    expect(grants.consume(1, [path])).toBe(false)
  })
})
