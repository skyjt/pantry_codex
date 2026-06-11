import type DatabaseT from 'better-sqlite3'

export interface ConvRow {
  id: string
  type: string
  peer_or_group_id: string
  last_ts: number
  unread: number
  pinned: number
  muted: number
  draft: string
  preview: string | null
}

/** 单聊会话 id 确定性生成：免查表、renderer 可直接反解 peerId */
export function singleConvId(peerId: string): string {
  return `single:${peerId}`
}

export class ConvRepo {
  private readonly ensureStmt: DatabaseT.Statement
  private readonly bumpStmt: DatabaseT.Statement
  private readonly incUnreadStmt: DatabaseT.Statement
  private readonly markReadStmt: DatabaseT.Statement
  private readonly listStmt: DatabaseT.Statement
  private readonly getStmt: DatabaseT.Statement

  constructor(db: DatabaseT.Database) {
    this.ensureStmt = db.prepare(`
      INSERT OR IGNORE INTO conversations (id, type, peer_or_group_id, last_ts)
      VALUES (?, 'single', ?, 0)
    `)
    this.bumpStmt = db.prepare('UPDATE conversations SET last_ts = MAX(last_ts, ?) WHERE id = ?')
    this.incUnreadStmt = db.prepare('UPDATE conversations SET unread = unread + 1 WHERE id = ?')
    this.markReadStmt = db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?')
    // preview 取该会话最新一条消息正文（会话列表摘要）
    this.listStmt = db.prepare(`
      SELECT c.*, (
        SELECT m.content FROM messages m
        WHERE m.conv_id = c.id ORDER BY m.seq DESC LIMIT 1
      ) AS preview
      FROM conversations c
      ORDER BY c.pinned DESC, c.last_ts DESC
    `)
    this.getStmt = db.prepare(`
      SELECT c.*, (
        SELECT m.content FROM messages m
        WHERE m.conv_id = c.id ORDER BY m.seq DESC LIMIT 1
      ) AS preview
      FROM conversations c WHERE c.id = ?
    `)
  }

  ensureSingle(peerId: string): string {
    const id = singleConvId(peerId)
    this.ensureStmt.run(id, peerId)
    return id
  }

  bump(convId: string, ts: number): void {
    this.bumpStmt.run(ts, convId)
  }

  incUnread(convId: string): void {
    this.incUnreadStmt.run(convId)
  }

  markRead(convId: string): void {
    this.markReadStmt.run(convId)
  }

  list(): ConvRow[] {
    return this.listStmt.all() as ConvRow[]
  }

  get(convId: string): ConvRow | undefined {
    return this.getStmt.get(convId) as ConvRow | undefined
  }
}
