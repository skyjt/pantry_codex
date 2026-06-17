import { describe, expect, it } from 'vitest'
import { resolveDevRendererUrl } from './renderer-url'

describe('resolveDevRendererUrl', () => {
  it('只在非打包模式接受本机 dev renderer URL', () => {
    expect(resolveDevRendererUrl('http://localhost:5173', '/settings', false)).toBe(
      'http://localhost:5173/#/settings'
    )
    expect(resolveDevRendererUrl('http://127.0.0.1:5173', '#/capture', false)).toBe(
      'http://127.0.0.1:5173/#/capture'
    )
    expect(resolveDevRendererUrl('http://example.com:5173', '/settings', false)).toBeNull()
    expect(resolveDevRendererUrl('file:///tmp/evil.html', '/settings', false)).toBeNull()
    expect(resolveDevRendererUrl('http://localhost:5173', '/settings', true)).toBeNull()
  })
})
