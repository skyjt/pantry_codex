import type DatabaseT from 'better-sqlite3'
import type { Platform, Profile } from '../../shared/protocol'
import type { PeerRecord } from '../net/peer-registry'

// 联系人持久化（F-DISC-7 历史联系人持久保留）。
// 写入：registry 变化时整表 upsert（≤1000 行事务内毫秒级）；
// 读取：启动时全量载入，以离线态种回 registry。

interface PeerRow {
  node_id: string
  nick: string
  remark: string | null
  company: string
  dept: string
  team: string
  avatar: number
  host: string
  platform: string
  ip: string
  udp_port: number
  tcp_port: number
  profile_rev: number
  caps: string
  ver: string
  first_seen: number
  last_seen: number
}

function toPlatform(value: string): Platform {
  return value === 'win' || value === 'mac' ? value : 'linux'
}

export class PeersRepo {
  private readonly upsertStmt: DatabaseT.Statement
  private readonly selectAllStmt: DatabaseT.Statement
  private readonly upsertManyTx: (records: PeerRecord[]) => void

  constructor(db: DatabaseT.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO peers (
        node_id, nick, company, dept, team, avatar, host, platform,
        ip, udp_port, tcp_port, profile_rev, caps, ver, first_seen, last_seen
      ) VALUES (
        @nodeId, @nick, @company, @dept, @team, @avatar, @host, @platform,
        @ip, @udpPort, @tcpPort, @profileRev, @caps, @ver, @now, @lastSeen
      )
      ON CONFLICT(node_id) DO UPDATE SET
        nick = excluded.nick, company = excluded.company, dept = excluded.dept,
        team = excluded.team, avatar = excluded.avatar, host = excluded.host,
        platform = excluded.platform, ip = excluded.ip, udp_port = excluded.udp_port,
        tcp_port = excluded.tcp_port, profile_rev = excluded.profile_rev,
        caps = excluded.caps, ver = excluded.ver, last_seen = excluded.last_seen
    `) // remark 与 first_seen 不被覆盖：备注是本地资产，首次见面时间只写一次

    this.selectAllStmt = db.prepare('SELECT * FROM peers ORDER BY last_seen DESC')

    this.upsertManyTx = db.transaction((records: PeerRecord[]) => {
      for (const record of records) this.upsertOne(record)
    }) as unknown as (records: PeerRecord[]) => void
  }

  private upsertOne(record: PeerRecord): void {
    const p = record.profile
    this.upsertStmt.run({
      nodeId: p.nodeId,
      nick: p.nick,
      company: p.company,
      dept: p.dept,
      team: p.team,
      avatar: p.avatar,
      host: p.host,
      platform: p.platform,
      ip: record.ip,
      udpPort: record.udpPort,
      tcpPort: p.tcpPort,
      profileRev: p.profileRev,
      caps: JSON.stringify(p.caps),
      ver: p.ver,
      now: Date.now(),
      lastSeen: record.lastSeen
    })
  }

  upsertMany(records: PeerRecord[]): void {
    if (records.length > 0) this.upsertManyTx(records)
  }

  /** 全量载入为离线记录（在线态由网络层实时判定，不持久化） */
  loadAll(): PeerRecord[] {
    const rows = this.selectAllStmt.all() as PeerRow[]
    return rows.map((row) => {
      let caps: string[] = []
      try {
        const parsed: unknown = JSON.parse(row.caps)
        if (Array.isArray(parsed)) caps = parsed.filter((c): c is string => typeof c === 'string')
      } catch {
        // 损坏的 caps 字段不致命，置空即可
      }
      const profile: Profile = {
        nodeId: row.node_id,
        nick: row.nick,
        company: row.company,
        dept: row.dept,
        team: row.team,
        avatar: row.avatar,
        profileRev: row.profile_rev,
        host: row.host,
        platform: toPlatform(row.platform),
        tcpPort: row.tcp_port,
        ver: row.ver,
        caps
      }
      return {
        profile,
        ip: row.ip,
        udpPort: row.udp_port,
        lastSeen: row.last_seen,
        online: false
      }
    })
  }
}
