import type DatabaseT from 'better-sqlite3'
import type { QueueStore } from '../net/messenger'

/** 补发队列的 SQLite 实现（§7.2）：持久化保证"关机重启后欠的消息还认账" */
export class QueueRepo implements QueueStore {
  private readonly enqueueStmt: DatabaseT.Statement
  private readonly listStmt: DatabaseT.Statement
  private readonly removeStmt: DatabaseT.Statement
  private readonly pruneTtlStmt: DatabaseT.Statement
  private readonly overflowPeersStmt: DatabaseT.Statement
  private readonly pruneOverflowStmt: DatabaseT.Statement

  constructor(db: DatabaseT.Database) {
    this.enqueueStmt = db.prepare(`
      INSERT OR REPLACE INTO send_queue (msg_id, peer_id, envelope, created, attempts)
      VALUES (?, ?, ?, ?, 0)
    `)
    this.listStmt = db.prepare(
      'SELECT msg_id, envelope FROM send_queue WHERE peer_id = ? ORDER BY created'
    )
    this.removeStmt = db.prepare('DELETE FROM send_queue WHERE msg_id = ?')
    this.pruneTtlStmt = db.prepare('DELETE FROM send_queue WHERE created < ? RETURNING msg_id')
    this.overflowPeersStmt = db.prepare(`
      SELECT peer_id, COUNT(*) AS n FROM send_queue GROUP BY peer_id HAVING n > ?
    `)
    // 超限裁旧留新（最早入队的先裁）
    this.pruneOverflowStmt = db.prepare(`
      DELETE FROM send_queue WHERE msg_id IN (
        SELECT msg_id FROM send_queue WHERE peer_id = ? ORDER BY created ASC LIMIT ?
      ) RETURNING msg_id
    `)
  }

  enqueue(msgId: string, peerId: string, envelopeJson: string, created: number): void {
    this.enqueueStmt.run(msgId, peerId, envelopeJson, created)
  }

  listByPeer(peerId: string): Array<{ msgId: string; envelopeJson: string }> {
    const rows = this.listStmt.all(peerId) as Array<{ msg_id: string; envelope: string }>
    return rows.map((r) => ({ msgId: r.msg_id, envelopeJson: r.envelope }))
  }

  remove(msgId: string): void {
    this.removeStmt.run(msgId)
  }

  prune(ttlMs: number, maxPerPeer: number): string[] {
    const pruned: string[] = []
    const expired = this.pruneTtlStmt.all(Date.now() - ttlMs) as Array<{ msg_id: string }>
    pruned.push(...expired.map((r) => r.msg_id))
    const overflow = this.overflowPeersStmt.all(maxPerPeer) as Array<{ peer_id: string; n: number }>
    for (const peer of overflow) {
      const cut = this.pruneOverflowStmt.all(peer.peer_id, peer.n - maxPerPeer) as Array<{
        msg_id: string
      }>
      pruned.push(...cut.map((r) => r.msg_id))
    }
    return pruned
  }
}
