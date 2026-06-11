import type DatabaseT from 'better-sqlite3'

export interface StickerRow {
  id: string
  path: string
  w: number
  h: number
  animated: number
  sort: number
  added: number
}

export class StickerRepo {
  private readonly insertStmt: DatabaseT.Statement
  private readonly listStmt: DatabaseT.Statement
  private readonly removeStmt: DatabaseT.Statement
  private readonly getStmt: DatabaseT.Statement
  private readonly sortStmt: DatabaseT.Statement

  constructor(private readonly db: DatabaseT.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO stickers (id, path, w, h, animated, sort, added)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `)
    // rowid 决胜：同毫秒收藏的多个表情保持"后插在前"的稳定顺序
    this.listStmt = db.prepare(`
      SELECT * FROM stickers
      ORDER BY CASE WHEN sort = 0 THEN 0 ELSE 1 END, sort ASC, added DESC, rowid DESC
    `)
    this.removeStmt = db.prepare('DELETE FROM stickers WHERE id = ?')
    this.getStmt = db.prepare('SELECT * FROM stickers WHERE id = ?')
    this.sortStmt = db.prepare('UPDATE stickers SET sort = ? WHERE id = ?')
  }

  insert(id: string, path: string, w: number, h: number, animated: boolean): void {
    this.insertStmt.run(id, path, w, h, animated ? 1 : 0, Date.now())
  }

  list(): StickerRow[] {
    return this.listStmt.all() as StickerRow[]
  }

  get(id: string): StickerRow | undefined {
    return this.getStmt.get(id) as StickerRow | undefined
  }

  remove(id: string): string | null {
    const row = this.get(id)
    this.removeStmt.run(id)
    return row?.path ?? null
  }

  reorder(ids: string[]): void {
    const tx = this.db.transaction((ordered: string[]) => {
      ordered.forEach((id, index) => this.sortStmt.run(index + 1, id))
    })
    tx(ids)
  }
}
