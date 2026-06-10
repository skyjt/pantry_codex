import { writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

/** 原子写：临时文件 + rename，避免断电/崩溃留下半截 JSON（tech-design §1） */
export function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = join(dirname(filePath), `.${basename(filePath)}.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}
