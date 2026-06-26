import { describe, expect, it } from 'vitest'
import { decode, encode, makeEnvelope } from './codec'
import {
  GROUP_IMG_AUTO_ACCEPT,
  MSG_TYPES,
  UDP_MAX_INBOUND,
  type FileCtlPayload,
  type GroupPayload,
  type MsgPayload,
  type Profile,
  type ProfilePayload,
  type ScanRangesPayload,
  type UpdateReqPayload
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

  it('update 自更新请求报文：合法往返 + 坏报文白名单拒绝', () => {
    const ok = decode(
      encode(makeEnvelope<UpdateReqPayload>(MSG_TYPES.update, 'node-aaaa', { op: 'req', platform: 'win' }))
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.known).toBe(true)
      expect((ok.env.payload as UpdateReqPayload).platform).toBe('win')
    }
    // op 非 req / platform 非法 / 缺字段 → 丢弃
    expect(decode(encode(makeEnvelope(MSG_TYPES.update, 'n', { op: 'x', platform: 'win' }))).ok).toBe(false)
    expect(decode(encode(makeEnvelope(MSG_TYPES.update, 'n', { op: 'req', platform: 'bad' }))).ok).toBe(false)
    expect(decode(encode(makeEnvelope(MSG_TYPES.update, 'n', { op: 'req' }))).ok).toBe(false)
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

  it('nudge 是无正文的私聊即时动作，不能带补发标记', () => {
    const ok = makeEnvelope<MsgPayload>(MSG_TYPES.msg, 'node-aaaa', { kind: 'nudge' })
    expect(decode(encode(ok))).toMatchObject({ ok: true, known: true })

    const resend = makeEnvelope(MSG_TYPES.msg, 'node-aaaa', { kind: 'nudge', resend: true })
    expect(decode(encode(resend))).toEqual({ ok: false, reason: 'bad-payload:msg' })
  })

  it('pk 只接受匹配玩法的结果，且不允许补发标记', () => {
    const dice = makeEnvelope<MsgPayload>(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'pk',
      game: 'dice',
      result: 6
    })
    expect(decode(encode(dice))).toMatchObject({ ok: true, known: true })

    const rps = makeEnvelope<MsgPayload>(MSG_TYPES.msg, 'node-aaaa', {
      kind: 'pk',
      game: 'rps',
      result: 'rock',
      groupId: 'group-1',
      groupRev: 1
    })
    expect(decode(encode(rps))).toMatchObject({ ok: true, known: true })

    expect(
      decode(encode(makeEnvelope(MSG_TYPES.msg, 'node-aaaa', { kind: 'pk', game: 'dice', result: 7 })))
    ).toEqual({ ok: false, reason: 'bad-payload:msg' })
    expect(
      decode(
        encode(makeEnvelope(MSG_TYPES.msg, 'node-aaaa', { kind: 'pk', game: 'rps', result: 'rock', resend: true }))
      )
    ).toEqual({ ok: false, reason: 'bad-payload:msg' })
  })

  it('scan-ranges 只接受受控 CIDR 列表', () => {
    const ok = makeEnvelope<ScanRangesPayload>(MSG_TYPES.scanRanges, 'node-aaaa', {
      ranges: [{ cidr: '10.1.2.0/24', addedAt: Date.now() }]
    })
    expect(decode(encode(ok))).toMatchObject({ ok: true, known: true })

    const tooLarge = makeEnvelope<ScanRangesPayload>(MSG_TYPES.scanRanges, 'node-aaaa', {
      ranges: [{ cidr: '10.0.0.0/16', addedAt: Date.now() }]
    })
    expect(decode(encode(tooLarge))).toEqual({
      ok: false,
      reason: 'bad-payload:scan-ranges'
    })

    const missingTime = makeEnvelope(MSG_TYPES.scanRanges, 'node-aaaa', {
      ranges: [{ cidr: '10.1.2.0/24' }]
    })
    expect(decode(encode(missingTime))).toEqual({
      ok: false,
      reason: 'bad-payload:scan-ranges'
    })
  })

  it('group.info 支持 creatorId，旧包缺 creatorId 仍兼容', () => {
    const group = {
      groupId: 'group-1',
      name: '项目组',
      members: ['node-aaaa', 'node-bbbb'],
      rev: 1,
      updatedBy: 'node-aaaa',
      updatedTs: Date.now(),
      creatorIp: '10.0.0.1',
      creatorId: 'node-aaaa',
      adminSecretHash: '',
      adminHint: ''
    }
    const ok = makeEnvelope<GroupPayload>(MSG_TYPES.group, 'node-aaaa', {
      op: 'info',
      group
    })
    expect(decode(encode(ok))).toMatchObject({ ok: true, known: true })

    const legacy = makeEnvelope(MSG_TYPES.group, 'node-aaaa', {
      op: 'info',
      group: { ...group, creatorId: undefined }
    })
    expect(decode(encode(legacy))).toMatchObject({ ok: true, known: true })

    const badCreator = makeEnvelope(MSG_TYPES.group, 'node-aaaa', {
      op: 'info',
      group: { ...group, creatorId: 'x'.repeat(65) }
    })
    expect(decode(encode(badCreator))).toEqual({
      ok: false,
      reason: 'bad-payload:group'
    })
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

    const oversizedGroupImage = makeEnvelope(MSG_TYPES.fileCtl, 'node-aaaa', {
      op: 'offer',
      transferId: 'transfer-1',
      seq: 1,
      total: 1,
      files: [{ fileId: 'file-1', path: 'a.png', size: GROUP_IMG_AUTO_ACCEPT + 1 }],
      totalSize: GROUP_IMG_AUTO_ACCEPT + 1,
      fileCount: 1,
      rootName: 'a.png',
      purpose: 'image',
      groupId: 'group-1',
      groupRev: 2
    })
    expect(decode(encode(oversizedGroupImage))).toEqual({
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
