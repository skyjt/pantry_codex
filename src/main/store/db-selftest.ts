// 数据库自测：经 ELECTRON_RUN_AS_NODE 在 Electron 内置 Node 16.17 上执行，
// 验证 better-sqlite3 对 Electron 22 ABI 真实可用（npm run test:db）。
// 用 node:assert 而非 vitest —— vitest 跑在开发机新版 Node 上，加载不了 Electron ABI 的原生模块。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './db'
import { PeersRepo } from './peers-repo'
import { toFtsQuery, toFtsTokens } from './fts'
import type { PeerRecord } from '../net/peer-registry'

function makePeer(name: string, rev = 1): PeerRecord {
  return {
    profile: {
      nodeId: `node-${name}`,
      nick: name,
      company: '某某科技',
      dept: '研发部',
      team: '后端组',
      avatar: -1,
      profileRev: rev,
      host: `${name}-pc`,
      platform: 'win',
      tcpPort: 17879,
      ver: '0.1.0',
      caps: ['grp1']
    },
    ip: '10.0.0.8',
    udpPort: 17878,
    lastSeen: Date.now(),
    online: true
  }
}

const dir = mkdtempSync(join(tmpdir(), 'pantry-dbtest-'))
const db = openDatabase(join(dir, 'chat.db'))

try {
  console.log(`[db-selftest] runtime node=${process.versions.node} abi=${process.versions.modules}`)

  // 1. 迁移就位
  assert.equal(db.pragma('user_version', { simple: true }), 1, '迁移版本应为 1')
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal', '应为 WAL 模式')

  // 2. 联系人 upsert / 载入往返
  const repo = new PeersRepo(db)
  repo.upsertMany([makePeer('alice'), makePeer('bob')])
  let loaded = repo.loadAll()
  assert.equal(loaded.length, 2)
  assert.equal(loaded.every((p) => p.online === false), true, '载入应一律离线态')

  // 3. 资料更新覆盖、first_seen/remark 不被覆盖
  const firstSeenBefore = (
    db.prepare('SELECT first_seen FROM peers WHERE node_id = ?').get('node-alice') as {
      first_seen: number
    }
  ).first_seen
  db.prepare('UPDATE peers SET remark = ? WHERE node_id = ?').run('备注-爱丽丝', 'node-alice')
  const updated = makePeer('alice', 2)
  updated.profile.nick = 'alice-改名'
  repo.upsertMany([updated])
  loaded = repo.loadAll()
  const alice = loaded.find((p) => p.profile.nodeId === 'node-alice')
  assert.equal(alice?.profile.nick, 'alice-改名')
  assert.equal(alice?.profile.profileRev, 2)
  const rowAfter = db
    .prepare('SELECT first_seen, remark FROM peers WHERE node_id = ?')
    .get('node-alice') as { first_seen: number; remark: string }
  assert.equal(rowAfter.first_seen, firstSeenBefore, 'first_seen 只写一次')
  assert.equal(rowAfter.remark, '备注-爱丽丝', 'remark 是本地资产，upsert 不得覆盖')

  // 4. FTS 中文按字检索往返
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conv_id, sender_id, is_mine, kind, content, ts, seq, status)
    VALUES (?, ?, ?, 1, 'text', ?, ?, ?, 'sent')
  `)
  const insertFts = db.prepare('INSERT INTO messages_fts (msg_id, text) VALUES (?, ?)')
  const texts = ['需求文档v3发我一下', '今晚一起吃饭吗', '文档已经发你邮箱了']
  texts.forEach((text, i) => {
    const id = `msg-${i}`
    insertMsg.run(id, 'conv-1', 'node-alice', text, Date.now(), i)
    insertFts.run(id, toFtsTokens(text))
  })
  const hits = db
    .prepare('SELECT msg_id FROM messages_fts WHERE messages_fts MATCH ?')
    .all(toFtsQuery('文档')) as Array<{ msg_id: string }>
  assert.deepEqual(
    hits.map((h) => h.msg_id).sort(),
    ['msg-0', 'msg-2'],
    '「文档」应命中两条'
  )
  const none = db
    .prepare('SELECT msg_id FROM messages_fts WHERE messages_fts MATCH ?')
    .all(toFtsQuery('文邮')) as unknown[]
  assert.equal(none.length, 0, '非连续字不得命中（短语匹配）')

  console.log('[db-selftest] PASS —— 迁移/联系人持久化/中文FTS 全部通过')
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
