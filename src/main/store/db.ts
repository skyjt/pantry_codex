import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { applyMigrations } from './migrations'

// 全项目唯一允许的 native 模块（AGENTS.md 红线 #3）。
// WAL：崩溃不坏库（NFR 数据安全）；同步 API：主进程单线程顺序访问，最简单可靠。

export type AppDatabase = Database.Database

export function openDatabase(dbPath: string): AppDatabase {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

/** 文件库打不开时的降级（磁盘满/权限）：功能照常，本次会话不持久 */
export function openMemoryDatabase(): AppDatabase {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}
