import type DatabaseT from 'better-sqlite3'
import type { DedupStore } from '../net/messenger'

/** 已收消息 ID 去重（§7.2）：持久化 24h 窗口，覆盖"补发 + 重启"的重复场景 */
export class DedupRepo implements DedupStore {
  private readonly hasStmt: DatabaseT.Statement
  private readonly addStmt: DatabaseT.Statement
  private readonly pruneStmt: DatabaseT.Statement

  constructor(db: DatabaseT.Database) {
    this.hasStmt = db.prepare('SELECT 1 FROM dedup WHERE msg_id = ?')
    this.addStmt = db.prepare('INSERT OR IGNORE INTO dedup (msg_id, recv_ts) VALUES (?, ?)')
    this.pruneStmt = db.prepare('DELETE FROM dedup WHERE recv_ts < ?')
  }

  has(msgId: string): boolean {
    return this.hasStmt.get(msgId) !== undefined
  }

  add(msgId: string, recvTs: number): void {
    this.addStmt.run(msgId, recvTs)
  }

  prune(ttlMs: number): void {
    this.pruneStmt.run(Date.now() - ttlMs)
  }
}
