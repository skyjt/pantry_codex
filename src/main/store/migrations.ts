import type DatabaseT from 'better-sqlite3'

// 库表迁移：PRAGMA user_version 递增（tech-design §5）。
// 只追加新迁移，永不修改已发布的旧迁移。本文件只引类型，不引驱动运行时。

export const MIGRATIONS: ReadonlyArray<string> = [
  // v1：发现层 + 消息层地基
  `
  CREATE TABLE peers (
    node_id     TEXT PRIMARY KEY,
    nick        TEXT NOT NULL,
    remark      TEXT,                -- 本地备注名（F-DISC-9），不入协议
    company     TEXT NOT NULL DEFAULT '',
    dept        TEXT NOT NULL DEFAULT '',
    team        TEXT NOT NULL DEFAULT '',
    avatar      INTEGER NOT NULL DEFAULT -1,
    host        TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT 'linux',
    ip          TEXT NOT NULL DEFAULT '',
    udp_port    INTEGER NOT NULL DEFAULT 0,
    tcp_port    INTEGER NOT NULL DEFAULT 0,
    profile_rev INTEGER NOT NULL DEFAULT 0,
    caps        TEXT NOT NULL DEFAULT '[]',
    ver         TEXT NOT NULL DEFAULT '',
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  );
  CREATE INDEX idx_peers_last_seen ON peers(last_seen);

  CREATE TABLE conversations (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL,            -- 'single' | 'group'
    peer_or_group_id TEXT NOT NULL,
    last_ts          INTEGER NOT NULL DEFAULT 0,
    unread           INTEGER NOT NULL DEFAULT 0,
    pinned           INTEGER NOT NULL DEFAULT 0,
    muted            INTEGER NOT NULL DEFAULT 0,
    draft            TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX idx_conv_target ON conversations(type, peer_or_group_id);

  CREATE TABLE messages (
    id        TEXT PRIMARY KEY,                -- 协议 msgId，全局唯一（去重/撤回/补发的锚点）
    conv_id   TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    is_mine   INTEGER NOT NULL,
    kind      TEXT NOT NULL,                   -- text | image | sticker | group-text ...
    content   TEXT NOT NULL DEFAULT '',
    file_ref  TEXT,                            -- JSON
    ts        INTEGER NOT NULL,
    seq       INTEGER NOT NULL,                -- 本地单调递增，时钟漂移兜底排序
    status    TEXT NOT NULL                    -- sending | sent | queued | failed | recalled
  );
  CREATE INDEX idx_messages_conv ON messages(conv_id, ts, seq);

  CREATE VIRTUAL TABLE messages_fts USING fts5(
    msg_id UNINDEXED,
    text                                        -- 入库时中文已按字预切（store/fts.ts）
  );

  CREATE TABLE send_queue (
    msg_id   TEXT PRIMARY KEY,
    peer_id  TEXT NOT NULL,
    envelope TEXT NOT NULL,                     -- 完整信封 JSON，上线后原样补发
    created  INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_queue_peer ON send_queue(peer_id, created);

  CREATE TABLE dedup (
    msg_id  TEXT PRIMARY KEY,
    recv_ts INTEGER NOT NULL
  );
  CREATE INDEX idx_dedup_ts ON dedup(recv_ts);
  `,

  // v2：文件传输记录（v0.2）
  `
  CREATE TABLE transfers (
    transfer_id TEXT PRIMARY KEY,
    msg_id      TEXT NOT NULL,
    peer_id     TEXT NOT NULL,
    direction   TEXT NOT NULL,              -- 'in' | 'out'
    files       TEXT NOT NULL DEFAULT '{}', -- 服务层 JSON：{name, savedPath?}
    status      TEXT NOT NULL,              -- offering|accepted|done|declined|canceled|failed
    bytes_done  INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    ts          INTEGER NOT NULL
  );
  CREATE INDEX idx_transfers_status ON transfers(status);
  `
]

export function applyMigrations(db: DatabaseT.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
