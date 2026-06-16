import { afterEach, describe, expect, it } from 'vitest'
import {
  MSG_TYPES,
  type PeersPayload,
  type Profile,
  type ScanRangeSummary,
  type Timings
} from '../../shared/protocol'
import { makeEnvelope } from './codec'
import { UdpChannel } from './udp'
import { PeerRegistry } from './peer-registry'
import { Discovery, type ManualPeer } from './discovery'
import { RangeSync } from './range-sync'

// 回环集成测试：两套完整网络栈在 127.0.0.1 对发。
// broadcastTargets 置空 —— 测试永不向真实局域网发包。

let nextPort = 41000 + Math.floor(Math.random() * 1000)

function makeProfile(name: string, port: number): Profile {
  return {
    nodeId: `node-${name}`,
    nick: name,
    company: '测试公司',
    dept: '测试部',
    team: '',
    avatar: -1,
    profileRev: 1,
    host: `${name}-host`,
    platform: 'linux',
    tcpPort: port + 1,
    ver: '0.0.0-test',
    caps: []
  }
}

interface Stack {
  udp: UdpChannel
  registry: PeerRegistry
  discovery: Discovery
  rangeSync: RangeSync
  profile: Profile
  port: number
  scanRanges: ScanRangeSummary[]
  ignoredRanges: Set<string>
}

const FAST: Partial<Timings> = {
  presenceInterval: 100,
  offlineAfter: 400,
  sweepInterval: 50,
  entryReplyJitterBase: 1, // 测试中应答不抖动
  entryReplyJitterMax: 1,
  gossipInterval: 150
}

const stacks: Stack[] = []

async function makeStack(name: string, manualPeers: ManualPeer[] = []): Promise<Stack> {
  nextPort += 2
  const port = nextPort
  const profile = makeProfile(name, port)
  const udp = new UdpChannel({ port, bindAddress: '127.0.0.1', broadcastTargets: [] })
  const registry = new PeerRegistry(profile.nodeId)
  const discovery = new Discovery({ udp, registry, profile, manualPeers, timings: FAST })
  const scanRanges: ScanRangeSummary[] = []
  const ignoredRanges = new Set<string>()
  const rangeSync = new RangeSync({
    udp,
    registry,
    selfId: profile.nodeId,
    getRanges: () => scanRanges,
    acceptRanges: (_from, ranges) => {
      for (const range of ranges) {
        if (ignoredRanges.has(range.cidr)) continue
        if (scanRanges.some((item) => item.cidr === range.cidr)) continue
        scanRanges.push(range)
      }
    },
    timings: {
      ...FAST,
      scanRangeShareInitialMin: 1,
      scanRangeShareInitialMax: 1,
      scanRangeShareInterval: 1_000
    }
  })
  await udp.start()
  const stack: Stack = { udp, registry, discovery, rangeSync, profile, port, scanRanges, ignoredRanges }
  stacks.push(stack)
  return stack
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(cond: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (cond()) return
    await sleep(25)
  }
  throw new Error('waitFor 超时')
}

afterEach(async () => {
  for (const stack of stacks.splice(0)) {
    stack.rangeSync.stop()
    stack.discovery.stop()
    await stack.udp.stop()
  }
})

describe('discovery 回环集成', () => {
  it('手动节点互相发现，graceful 退出立刻离线', async () => {
    const a = await makeStack('alice')
    const b = await makeStack('bob', [{ host: '127.0.0.1', port: a.port }])

    a.discovery.start()
    b.discovery.start() // B 向 A 单播 entry → A 回 alive → 双向入表

    await waitFor(
      () =>
        a.registry.get(b.profile.nodeId)?.online === true &&
        b.registry.get(a.profile.nodeId)?.online === true
    )
    expect(a.registry.get(b.profile.nodeId)?.profile.nick).toBe('bob')
    expect(b.registry.get(a.profile.nodeId)?.profile.nick).toBe('alice')

    b.discovery.stop() // exit 单播 → A 立刻标灰，不等心跳超时
    await waitFor(() => a.registry.get(b.profile.nodeId)?.online === false)
  })

  it('异常掉线（不发 exit）靠心跳超时判离线', async () => {
    const a = await makeStack('alice')
    const b = await makeStack('bob', [{ host: '127.0.0.1', port: a.port }])
    a.discovery.start()
    b.discovery.start()
    await waitFor(() => a.registry.get(b.profile.nodeId)?.online === true)

    await b.udp.stop() // 模拟崩溃/拔网线：没有 exit，心跳也停了

    await waitFor(() => a.registry.get(b.profile.nodeId)?.online === false, 3000)
  })

  it('gossip：互不相识的两端经桥节点互见；投毒条目不入表', async () => {
    const bridge = await makeStack('bridge')
    const a = await makeStack('alice', [{ host: '127.0.0.1', port: bridge.port }])
    const c = await makeStack('carol', [{ host: '127.0.0.1', port: bridge.port }])
    bridge.discovery.start()
    a.discovery.start()
    c.discovery.start()

    // a、c 都只认识 bridge；"结识即交换"+周期 gossip 应让 a/c 互见（§6.3 三板斧之三）
    await waitFor(
      () =>
        a.registry.get(c.profile.nodeId)?.online === true &&
        c.registry.get(a.profile.nodeId)?.online === true,
      4000
    )
    expect(a.registry.get(c.profile.nodeId)?.profile.nick).toBe('carol')

    // 投毒：伪造 peers 报文塞一个不存在的节点 → a 只会发 entry 验证（无人应答），不得入表
    const evil = makeEnvelope<PeersPayload>(MSG_TYPES.peers, bridge.profile.nodeId, {
      peers: [
        { nodeId: 'node-ghost', ip: '127.0.0.1', udpPort: 9, tcpPort: 9, lastSeen: Date.now() }
      ]
    })
    bridge.udp.send(evil, '127.0.0.1', a.port)
    await sleep(400)
    expect(a.registry.get('node-ghost')).toBeUndefined()
  })

  it('资料变更后，presence 版本失配触发自动刷新（防机器换人）', async () => {
    const a = await makeStack('alice')
    const b = await makeStack('bob', [{ host: '127.0.0.1', port: a.port }])
    a.discovery.start()
    b.discovery.start()
    await waitFor(() => a.registry.get(b.profile.nodeId)?.online === true)

    // B 改名 + 资料版本号 +1（Discovery 持有 profile 引用，原地修改即生效）
    b.profile.nick = 'bob-换了个人'
    b.profile.profileRev = 2

    // A 在下个心跳发现 rev 失配 → 发 entry → B 回 alive 带新资料
    await waitFor(() => a.registry.get(b.profile.nodeId)?.profile.nick === 'bob-换了个人', 3000)
    expect(a.registry.get(b.profile.nodeId)?.profile.profileRev).toBe(2)
  })

  it('scan-ranges：在线节点低频同步网段记录，用户忽略后不自动加回', async () => {
    const a = await makeStack('alice')
    const b = await makeStack('bob', [{ host: '127.0.0.1', port: a.port }])
    a.scanRanges.push({ cidr: '10.1.2.0/24', addedAt: Date.now() })
    a.discovery.start()
    b.discovery.start()
    a.rangeSync.start()
    b.rangeSync.start()

    await waitFor(() => b.registry.get(a.profile.nodeId)?.online === true)
    a.rangeSync.shareNow()
    await waitFor(() => b.scanRanges.some((item) => item.cidr === '10.1.2.0/24'))

    b.scanRanges.splice(0, b.scanRanges.length)
    b.ignoredRanges.add('10.1.2.0/24')
    a.rangeSync.shareNow()
    await sleep(100)
    expect(b.scanRanges).toEqual([])
  })
})
