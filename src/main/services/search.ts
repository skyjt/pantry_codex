import type DatabaseT from 'better-sqlite3'
import type { SearchResult, MessageGroupHit, FileHit } from '../../shared/ipc'
import type { PeerRegistry } from '../net/peer-registry'
import { toFtsQuery } from '../store/fts'

// 全局搜索（F-MSG-5 / ui-design §6）：联系人（全量含离线）/ 聊天记录（按会话聚合）/ 文件。
// 中文按字短语匹配走 FTS5；联系人与文件名走 LIKE（千级数据量足够）。

export class SearchService {
  private readonly msgGroupStmt: DatabaseT.Statement
  private readonly msgLatestStmt: DatabaseT.Statement
  private readonly fileStmt: DatabaseT.Statement

  constructor(
    db: DatabaseT.Database,
    private readonly registry: PeerRegistry,
    private readonly remarkOf: (nodeId: string) => string = () => ''
  ) {
    this.msgGroupStmt = db.prepare(`
      SELECT m.conv_id AS convId, COUNT(*) AS n, MAX(m.seq) AS latestSeq
      FROM messages_fts f JOIN messages m ON m.id = f.msg_id
      WHERE messages_fts MATCH ? AND m.kind = 'text'
      GROUP BY m.conv_id ORDER BY MAX(m.ts) DESC LIMIT 10
    `)
    this.msgLatestStmt = db.prepare(`
      SELECT m.id, m.content, m.ts, m.seq
      FROM messages_fts f JOIN messages m ON m.id = f.msg_id
      WHERE messages_fts MATCH ? AND m.conv_id = ?
      ORDER BY m.seq DESC LIMIT 1
    `)
    this.fileStmt = db.prepare(`
      SELECT id, conv_id AS convId, content, ts, seq
      FROM messages
      WHERE kind IN ('file', 'image') AND content LIKE ? ESCAPE '\\'
      ORDER BY ts DESC LIMIT 20
    `)
  }

  query(raw: string): SearchResult {
    const q = raw.trim()
    if (!q) return { peers: [], messageGroups: [], files: [] }

    // 联系人：全量（含离线），昵称/公司/部门/团队/主机名任一命中
    const needle = q.toLowerCase()
    const peers = this.registry
      .list()
      .filter((r) => {
        const p = r.profile
        return [p.nick, this.remarkOf(p.nodeId), p.company, p.dept, p.team, p.host, r.ip].some(
          (s) => s.toLowerCase().includes(needle)
        )
      })
      .slice(0, 20)
      .map((r) => ({
        nodeId: r.profile.nodeId,
        nick: r.profile.nick,
        remark: this.remarkOf(r.profile.nodeId),
        company: r.profile.company,
        dept: r.profile.dept,
        team: r.profile.team,
        avatar: r.profile.avatar,
        host: r.profile.host,
        platform: r.profile.platform,
        ip: r.ip,
        online: r.online,
        lastSeen: r.lastSeen
      }))

    // 聊天记录：FTS 短语匹配，按会话聚合 + 各会话最新命中作摘要
    const messageGroups: MessageGroupHit[] = []
    const ftsQuery = toFtsQuery(q)
    if (ftsQuery) {
      const groups = this.msgGroupStmt.all(ftsQuery) as Array<{
        convId: string
        n: number
        latestSeq: number
      }>
      for (const g of groups) {
        const latest = this.msgLatestStmt.get(ftsQuery, g.convId) as
          | { id: string; content: string; ts: number; seq: number }
          | undefined
        messageGroups.push({
          convId: g.convId,
          peerId: g.convId.startsWith('single:') ? g.convId.slice(7) : g.convId,
          count: g.n,
          snippet: latest?.content ?? '',
          latestSeq: latest?.seq ?? g.latestSeq,
          latestMsgId: latest?.id ?? '',
          ts: latest?.ts ?? 0
        })
      }
    }

    // 文件/图片：按展示名模糊匹配（content 形如 "[文件] 名字"）
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`)
    const files = (
      this.fileStmt.all(`%${escaped}%`) as Array<{
        id: string
        convId: string
        content: string
        ts: number
        seq: number
      }>
    ).map(
      (row): FileHit => ({
        msgId: row.id,
        convId: row.convId,
        peerId: row.convId.startsWith('single:') ? row.convId.slice(7) : row.convId,
        name: row.content.replace(/^\[(文件|图片)\] ?/, ''),
        ts: row.ts,
        seq: row.seq
      })
    )

    return { peers, messageGroups, files }
  }
}
