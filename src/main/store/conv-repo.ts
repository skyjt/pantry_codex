import type DatabaseT from 'better-sqlite3'
import type { ConversationView } from '../../shared/ipc'

export interface ConvRow {
  id: string
  type: string
  peer_or_group_id: string
  last_ts: number
  unread: number
  pinned: number
  muted: number
  mentioned: number
  draft: string
  preview: string | null
}

/** 单聊会话 id 确定性生成：免查表、renderer 可直接反解 peerId */
export function singleConvId(peerId: string): string {
  return `single:${peerId}`
}

export function groupConvId(groupId: string): string {
  return `group:${groupId}`
}

/** 行 → 渲染层视图（chat / files / groups 服务共用） */
export function convRowToView(row: ConvRow): ConversationView {
  return {
    id: row.id,
    type: row.type === 'group' ? 'group' : 'single',
    peerId: row.peer_or_group_id,
    lastTs: row.last_ts,
    unread: row.unread,
    pinned: row.pinned !== 0,
    muted: row.muted !== 0,
    mentioned: row.mentioned !== 0,
    preview: row.preview ?? ''
  }
}

export class ConvRepo {
  private readonly ensureStmt: DatabaseT.Statement
  private readonly ensureGroupStmt: DatabaseT.Statement
  private readonly bumpStmt: DatabaseT.Statement
  private readonly incUnreadStmt: DatabaseT.Statement
  private readonly markMentionedStmt: DatabaseT.Statement
  private readonly markReadStmt: DatabaseT.Statement
  private readonly pinStmt: DatabaseT.Statement
  private readonly muteStmt: DatabaseT.Statement
  private readonly removeStmt: DatabaseT.Statement
  private readonly listStmt: DatabaseT.Statement
  private readonly getStmt: DatabaseT.Statement

  constructor(db: DatabaseT.Database) {
    this.ensureStmt = db.prepare(`
      INSERT OR IGNORE INTO conversations (id, type, peer_or_group_id, last_ts)
      VALUES (?, 'single', ?, 0)
    `)
    this.ensureGroupStmt = db.prepare(`
      INSERT OR IGNORE INTO conversations (id, type, peer_or_group_id, last_ts)
      VALUES (?, 'group', ?, 0)
    `)
    this.bumpStmt = db.prepare('UPDATE conversations SET last_ts = MAX(last_ts, ?) WHERE id = ?')
    this.incUnreadStmt = db.prepare('UPDATE conversations SET unread = unread + 1 WHERE id = ?')
    this.markMentionedStmt = db.prepare('UPDATE conversations SET mentioned = 1 WHERE id = ?')
    this.markReadStmt = db.prepare('UPDATE conversations SET unread = 0, mentioned = 0 WHERE id = ?')
    this.pinStmt = db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?')
    this.muteStmt = db.prepare('UPDATE conversations SET muted = ? WHERE id = ?')
    this.removeStmt = db.prepare('DELETE FROM conversations WHERE id = ?')
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

  ensureGroup(groupId: string): string {
    const id = groupConvId(groupId)
    this.ensureGroupStmt.run(id, groupId)
    return id
  }

  bump(convId: string, ts: number): void {
    this.bumpStmt.run(ts, convId)
  }

  incUnread(convId: string): void {
    this.incUnreadStmt.run(convId)
  }

  markMentioned(convId: string): void {
    this.markMentionedStmt.run(convId)
  }

  markRead(convId: string): void {
    this.markReadStmt.run(convId)
  }

  setPinned(convId: string, pinned: boolean): void {
    this.pinStmt.run(pinned ? 1 : 0, convId)
  }

  setMuted(convId: string, muted: boolean): void {
    this.muteStmt.run(muted ? 1 : 0, convId)
  }

  remove(convId: string): void {
    this.removeStmt.run(convId)
  }

  list(): ConvRow[] {
    return this.listStmt.all() as ConvRow[]
  }

  get(convId: string): ConvRow | undefined {
    return this.getStmt.get(convId) as ConvRow | undefined
  }
}
