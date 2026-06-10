import { describe, expect, it } from 'vitest'
import { decode, encode, makeEnvelope } from './codec'
import { MSG_TYPES, UDP_MAX_INBOUND, type Profile, type ProfilePayload } from '../../shared/protocol'

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

  it('缺 payload 拒收', () => {
    const raw = { v: 1, type: 'exit', id: 'x', from: 'node-aaaa', ts: Date.now() }
    const result = decode(Buffer.from(JSON.stringify(raw), 'utf8'))
    expect(result).toEqual({ ok: false, reason: 'no-payload' })
  })
})
