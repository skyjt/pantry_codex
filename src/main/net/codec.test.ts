import { describe, expect, it } from 'vitest'
import { decode, encode, makeEnvelope } from './codec'
import {
  MSG_TYPES,
  UDP_MAX_INBOUND,
  type FileCtlPayload,
  type MsgPayload,
  type Profile,
  type ProfilePayload
} from '../../shared/protocol'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    nodeId: 'node-aaaa',
    nick: '张三',
    company: '某某科技',
    dept: '研发部',
    team: '后端组',
    avatar: -1,
    profileRev: 1,
    host: 'zhangsan-pc',
    platform: 'mac',
    tcpPort: 17879,
    ver: '0.1.0',
    caps: [],
    ...overrides
  }
}

describe('codec', () => {
  it('entry 报文编解码往返', () => {
    const env = makeEnvelope<ProfilePayload>(MSG_TYPES.entry, 'node-aaaa', {
      profile: makeProfile()
    })
    const result = decode(encode(env))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.known).toBe(true)
    expect(result.env.type).toBe('entry')
    expect(result.env.from).toBe('node-aaaa')
    expect((result.env.payload as ProfilePayload).profile.nick).toBe('张三')
  })

  it('未知类型：信封合法即接受，标记 known=false（向前兼容）', () => {
    const env = makeEnvelope('future-fancy-type', 'node-aaaa', { anything: 1 })
    const result = decode(encode(env))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.known).toBe(false)
  })

  it('坏 JSON 拒收', () => {
    const result = decode(Buffer.from('{{{not json', 'utf8'))
    expect(result).toEqual({ ok: false, reason: 'bad-json' })
  })

  it('协议版本不符拒收', () => {
    const env = { ...makeEnvelope(MSG_TYPES.exit, 'node-aaaa', {}), v: 99 }
    const result = decode(Buffer.from(JSON.stringify(env), 'utf8'))
    expect(result).toEqual({ ok: false, reason: 'version' })
  })

  it('超长报文拒收', () => {
    const result = decode(Buffer.alloc(UDP_MAX_INBOUND + 1, 0x20))
    expect(result).toEqual({ ok: false, reason: 'oversize' })
  })

  it('entry 载荷昵称超长拒收（字段白名单校验）', () => {
    const env = makeEnvelope<ProfilePayload>(MSG_TYPES.entry, 'node-aaaa', {
      profile: makeProfile({ nick: '超'.repeat(33) })
    })
    const result = decode(encode(env))
    expect(result).toEqual({ ok: false, reason: 'bad-payload:entry' })
  })

  it('presence 载荷非法（负 seq）拒收', () => {
    const env = makeEnvelope(MSG_TYPES.presence, 'node-aaaa', { seq: -1, profileRev: 1 })
    const result = decode(encode(env))
    expect(result).toEqual({ ok: false, reason: 'bad-payload:presence' })
  })

  it('group-text mentions 白名单校验', () => {
    const ok = makeEnvelope<MsgPayload>(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'group-text',
      text: 'hi @alice',
      groupId: 'group-1',
      groupRev: 1,
      mentions: ['node-alice']
    })
    expect(decode(encode(ok))).toMatchObject({ ok: true, known: true })

    const tooMany = makeEnvelope(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'group-text',
      text: 'hi',
      groupId: 'group-1',
      groupRev: 1,
      mentions: Array.from({ length: 51 }, (_, i) => `node-${i}`)
    })
    expect(decode(encode(tooMany))).toEqual({ ok: false, reason: 'bad-payload:msg' })

    const badId = makeEnvelope(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'group-text',
      text: 'hi',
      groupId: 'group-1',
      groupRev: 1,
      mentions: ['']
    })
    expect(decode(encode(badId))).toEqual({ ok: false, reason: 'bad-payload:msg' })
  })

  it('recall 消息要求 targetId，群聊撤回要求 groupRev 配套', () => {
    const ok = makeEnvelope<MsgPayload>(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'recall',
      targetId: 'msg-target',
      groupId: 'group-1',
      groupRev: 2
    })
    expect(decode(encode(ok))).toMatchObject({ ok: true, known: true })

    const missingTarget = makeEnvelope(MSG_TYPES.msg, 'node-aaaa', { kind: 'recall' })
    expect(decode(encode(missingTarget))).toEqual({
      ok: false,
      reason: 'bad-payload:msg'
    })

    const missingRev = makeEnvelope(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'recall',
      targetId: 'msg-target',
      groupId: 'group-1'
    })
    expect(decode(encode(missingRev))).toEqual({ ok: false, reason: 'bad-payload:msg' })
  })

  it('file-ctl 群聊媒体 offer 要求 groupId/groupRev 成对出现', () => {
    const ok = makeEnvelope<FileCtlPayload>(MSG_TYPES.fileCtl, 'node-aaaa', {
      op: 'offer',
      transferId: 'transfer-1',
      seq: 1,
      total: 1,
      files: [{ fileId: 'file-1', path: 'a.png', size: 10 }],
      totalSize: 10,
      fileCount: 1,
      rootName: 'a.png',
      purpose: 'image',
      groupId: 'group-1',
      groupRev: 2
    })
    expect(decode(encode(ok))).toMatchObject({ ok: true, known: true })

    const missingRev = makeEnvelope(MSG_TYPES.fileCtl, 'node-aaaa', {
      op: 'offer',
      transferId: 'transfer-1',
      seq: 1,
      total: 1,
      files: [{ fileId: 'file-1', path: 'a.png', size: 10 }],
      totalSize: 10,
      fileCount: 1,
      rootName: 'a.png',
      groupId: 'group-1'
    })
    expect(decode(encode(missingRev))).toEqual({
      ok: false,
      reason: 'bad-payload:file-ctl'
    })
  })

  it('缺 payload 拒收', () => {
    const raw = { v: 1, type: 'exit', id: 'x', from: 'node-aaaa', ts: Date.now() }
    const result = decode(Buffer.from(JSON.stringify(raw), 'utf8'))
    expect(result).toEqual({ ok: false, reason: 'no-payload' })
  })
})
