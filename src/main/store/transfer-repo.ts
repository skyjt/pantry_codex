import type DatabaseT from 'better-sqlite3'

export interface TransferRow {
  transfer_id: string
  msg_id: string
  peer_id: string
  direction: string
  files: string
  status: string
  bytes_done: number
  total: number
  ts: number
}

export class TransferRepo {
  private readonly insertStmt: DatabaseT.Statement
  private readonly statusStmt: DatabaseT.Statement
  private readonly progressStmt: DatabaseT.Statement
  private readonly filesStmt: DatabaseT.Statement
  private readonly getStmt: DatabaseT.Statement
  private readonly resetActiveStmt: DatabaseT.Statement

  constructor(db: DatabaseT.Database) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO transfers (transfer_id, msg_id, peer_id, direction, files, status, bytes_done, total, ts)
      VALUES (@transferId, @msgId, @peerId, @direction, @files, @status, 0, @total, @ts)
    `)
    this.statusStmt = db.prepare('UPDATE transfers SET status = ? WHERE transfer_id = ?')
    this.progressStmt = db.prepare('UPDATE transfers SET bytes_done = ? WHERE transfer_id = ?')
    this.filesStmt = db.prepare('UPDATE transfers SET files = ? WHERE transfer_id = ?')
    this.getStmt = db.prepare('SELECT * FROM transfers WHERE transfer_id = ?')
    // 启动自愈：上次会话残留的进行中传输全部置失败（v0.2 不做断点续传）
    this.resetActiveStmt = db.prepare(
      "UPDATE transfers SET status = 'failed' WHERE status IN ('offering', 'accepted')"
    )
  }

  insert(row: {
    transferId: string
    msgId: string
    peerId: string
    direction: 'in' | 'out'
    files: string
    status: string
    total: number
    ts: number
  }): void {
    this.insertStmt.run(row)
  }

  updateStatus(transferId: string, status: string): void {
    this.statusStmt.run(status, transferId)
  }

  updateProgress(transferId: string, bytesDone: number): void {
    this.progressStmt.run(bytesDone, transferId)
  }

  updateFiles(transferId: string, filesJson: string): void {
    this.filesStmt.run(filesJson, transferId)
  }

  get(transferId: string): TransferRow | undefined {
    return this.getStmt.get(transferId) as TransferRow | undefined
  }

  resetActive(): number {
    return this.resetActiveStmt.run().changes
  }
}
