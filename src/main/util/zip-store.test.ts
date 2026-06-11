import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readZip, writeStoreZip } from './zip-store'

describe('zip-store', () => {
  it('写入并读取 UTF-8 文件名与内容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-zip-'))
    try {
      const path = join(dir, 'backup.pantry-bak')
      writeStoreZip(path, [
        { name: 'manifest.json', data: Buffer.from('{"ok":true}', 'utf8') },
        { name: '消息.jsonl', data: Buffer.from('你好\n', 'utf8') }
      ])
      const entries = readZip(path)
      expect(entries.get('manifest.json')?.toString('utf8')).toBe('{"ok":true}')
      expect(entries.get('消息.jsonl')?.toString('utf8')).toBe('你好\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
