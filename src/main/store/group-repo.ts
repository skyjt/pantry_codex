import type DatabaseT from 'better-sqlite3'
import type { GroupMeta } from '../../shared/protocol'

// 群元数据存储（§7.4）：rev 单调递增，冲突按 (rev, updatedTs) 取大——LWW 尽力而为一致性

interface GroupRow {
  group_id: string
  name: string
  members: string
  rev: number
  updated_by: string
  updated_ts: number
  creator_ip?: string
  admin_secret_hash?: string
}

function rowToMeta(row: GroupRow): GroupMeta {
  let members: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.members)
    if (Array.isArray(parsed)) members = parsed.filter((m): m is string => typeof m === 'string')
  } catch {
    // 损坏置空，等远端 info 重新灌入
  }
  return {
    groupId: row.group_id,
    name: row.name,
    members,
    rev: row.rev,
    updatedBy: row.updated_by,
    updatedTs: row.updated_ts,
    creatorIp: row.creator_ip ?? '',
    adminSecretHash: row.admin_secret_hash ?? ''
  }
}

function normalizeMeta(meta: GroupMeta): GroupMeta {
  return {
    ...meta,
    name: meta.name.slice(0, 64),
    members: [...new Set(meta.members)].filter((id) => id.length > 0),
    creatorIp: meta.creatorIp ?? '',
    adminSecretHash: meta.adminSecretHash ?? ''
  }
}

export class GroupRepo {
  private readonly upsertStmt: DatabaseT.Statement
  private readonly getStmt: DatabaseT.Statement
  private readonly listStmt: DatabaseT.Statement

  constructor(db: DatabaseT.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO groups (
        group_id, name, members, rev, updated_by, updated_ts, creator_ip, admin_secret_hash
      )
      VALUES (
        @groupId, @name, @members, @rev, @updatedBy, @updatedTs, @creatorIp, @adminSecretHash
      )
      ON CONFLICT(group_id) DO UPDATE SET
        name = excluded.name, members = excluded.members, rev = excluded.rev,
        updated_by = excluded.updated_by, updated_ts = excluded.updated_ts,
        creator_ip = excluded.creator_ip, admin_secret_hash = excluded.admin_secret_hash
    `)
    this.getStmt = db.prepare('SELECT * FROM groups WHERE group_id = ?')
    this.listStmt = db.prepare('SELECT * FROM groups ORDER BY updated_ts DESC')
  }

  save(meta: GroupMeta): void {
    const normalized = normalizeMeta(meta)
    this.upsertStmt.run({ ...normalized, members: JSON.stringify(normalized.members) })
  }

  get(groupId: string): GroupMeta | undefined {
    const row = this.getStmt.get(groupId) as GroupRow | undefined
    return row ? rowToMeta(row) : undefined
  }

  list(): GroupMeta[] {
    return (this.listStmt.all() as GroupRow[]).map(rowToMeta)
  }

  /** 远端元数据按 LWW 合并；返回是否采纳 */
  applyRemote(meta: GroupMeta): boolean {
    const local = this.get(meta.groupId)
    if (
      local &&
      (meta.rev < local.rev || (meta.rev === local.rev && meta.updatedTs <= local.updatedTs))
    ) {
      return false
    }
    this.save(meta)
    return true
  }
}
