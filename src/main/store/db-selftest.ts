// 数据库自测：经 ELECTRON_RUN_AS_NODE 在 Electron 内置 Node 16.17 上执行，
// 验证 better-sqlite3 对 Electron 22 ABI 真实可用（npm run test:db）。
// 用 node:assert 而非 vitest —— vitest 跑在开发机新版 Node 上，加载不了 Electron ABI 的原生模块。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './db'
import { PeersRepo } from './peers-repo'
import { ConvRepo } from './conv-repo'
import { MsgRepo } from './msg-repo'
import { QueueRepo } from './queue-repo'
import { DedupRepo } from './dedup-repo'
import { TransferRepo } from './transfer-repo'
import { toFtsQuery, toFtsTokens } from './fts'
import { SearchService } from '../services/search'
import { PeerRegistry } from '../net/peer-registry'
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
  assert.equal(db.pragma('user_version', { simple: true }), 2, '迁移版本应为 2')
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

  // 5. 会话/消息 repo 往返
  const convRepo = new ConvRepo(db)
  const msgRepo = new MsgRepo(db)
  const convId = convRepo.ensureSingle('node-bob')
  assert.equal(convId, 'single:node-bob')
  convRepo.ensureSingle('node-bob') // 幂等
  assert.equal(
    msgRepo.insert({
      id: 'm-1',
      convId,
      senderId: 'me',
      isMine: true,
      kind: 'text',
      content: '第一条消息',
      ts: 1000,
      status: 'sending'
    }),
    true
  )
  assert.equal(
    msgRepo.insert({
      id: 'm-1',
      convId,
      senderId: 'me',
      isMine: true,
      kind: 'text',
      content: '重复插入',
      ts: 1000,
      status: 'sending'
    }),
    false,
    '消息主键幂等'
  )
  msgRepo.insert({
    id: 'm-2',
    convId,
    senderId: 'node-bob',
    isMine: false,
    kind: 'text',
    content: '回你一条',
    ts: 2000,
    status: 'sent'
  })
  convRepo.bump(convId, 2000)
  convRepo.incUnread(convId)
  const conv = convRepo.get(convId)
  assert.equal(conv?.unread, 1)
  assert.equal(conv?.preview, '回你一条', '会话摘要应为最新一条')
  assert.deepEqual(
    msgRepo.page(convId, null, 10).map((m) => m.id),
    ['m-1', 'm-2'],
    '分页按时间升序'
  )
  msgRepo.updateStatus('m-1', 'sent')
  assert.equal(msgRepo.get('m-1')?.status, 'sent')
  convRepo.markRead(convId)
  assert.equal(convRepo.get(convId)?.unread, 0)

  // 6. 补发队列与去重
  const queueRepo = new QueueRepo(db)
  queueRepo.enqueue('q-1', 'node-bob', '{"x":1}', Date.now() - 8 * 24 * 3_600_000) // 已过期
  queueRepo.enqueue('q-2', 'node-bob', '{"x":2}', Date.now())
  assert.deepEqual(queueRepo.prune(7 * 24 * 3_600_000, 200), ['q-1'], '过期条目被裁剪')
  assert.deepEqual(
    queueRepo.listByPeer('node-bob').map((i) => i.msgId),
    ['q-2']
  )
  queueRepo.remove('q-2')
  assert.equal(queueRepo.listByPeer('node-bob').length, 0)

  const dedupRepo = new DedupRepo(db)
  dedupRepo.add('d-1', Date.now() - 25 * 3_600_000)
  dedupRepo.add('d-2', Date.now())
  assert.equal(dedupRepo.has('d-1'), true)
  dedupRepo.prune(24 * 3_600_000)
  assert.equal(dedupRepo.has('d-1'), false, '过期去重记录被清理')
  assert.equal(dedupRepo.has('d-2'), true)

  // 7. 启动自愈：残留"发送中"复位为失败（决议 #22）
  msgRepo.insert({
    id: 'm-3',
    convId,
    senderId: 'me',
    isMine: true,
    kind: 'text',
    content: '没发完就崩了',
    ts: 3000,
    status: 'sending'
  })
  assert.equal(msgRepo.resetStaleSending(), 1)
  assert.equal(msgRepo.get('m-3')?.status, 'failed')

  // 8. 传输记录
  const transferRepo = new TransferRepo(db)
  transferRepo.insert({
    transferId: 't-1',
    msgId: 'm-1',
    peerId: 'node-bob',
    direction: 'in',
    files: '{"name":"设计稿.zip"}',
    status: 'offering',
    total: 1024,
    ts: Date.now()
  })
  transferRepo.updateStatus('t-1', 'accepted')
  transferRepo.updateProgress('t-1', 512)
  transferRepo.updateFiles('t-1', '{"name":"设计稿.zip","savedPath":"/tmp/x"}')
  const t = transferRepo.get('t-1')
  assert.equal(t?.status, 'accepted')
  assert.equal(t?.bytes_done, 512)
  assert.ok(t?.files.includes('savedPath'))
  assert.equal(transferRepo.resetActive(), 1, '残留进行中传输启动置失败')
  assert.equal(transferRepo.get('t-1')?.status, 'failed')

  // 9. 全局搜索：聊天记录聚合 + 文件命中 + 上下文窗口
  const registry = new PeerRegistry('node-self')
  registry.seed([makePeer('alice')])
  const searchSvc = new SearchService(db, registry)
  msgRepo.insert({
    id: 'm-f1',
    convId,
    senderId: 'node-bob',
    isMine: false,
    kind: 'file',
    content: '[文件] 需求文档v3.docx',
    ts: 4000,
    status: 'sent'
  })
  const sr = searchSvc.query('文档')
  assert.ok(sr.messageGroups.length >= 1, '聊天记录应有聚合命中')
  assert.equal(sr.messageGroups[0].convId, 'conv-1', '命中应来自含「文档」的会话')
  assert.ok(sr.files.some((f) => f.name === '需求文档v3.docx'), '文件名应命中')
  assert.equal(searchSvc.query('alice').peers.length, 1, '联系人按昵称命中')
  assert.equal(searchSvc.query('   ').messageGroups.length, 0, '空查询返回空')

  const ctx = msgRepo.around(convId, 2, 25)
  assert.ok(ctx.some((m) => m.id === 'm-2'), '上下文窗口应包含目标')

  console.log('[db-selftest] PASS —— 迁移/联系人/会话消息/队列去重/传输/搜索/中文FTS 全部通过')
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
