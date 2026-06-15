import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { MSG_TYPES, type Envelope, type GroupMeta, type GroupPayload } from '../../shared/protocol'
import type { ConversationView } from '../../shared/ipc'
import { makeEnvelope } from '../net/codec'
import type { Messenger, SendOutcome } from '../net/messenger'
import type { ConvRepo } from '../store/conv-repo'
import type { GroupRepo } from '../store/group-repo'
import type { MsgRepo } from '../store/msg-repo'
import { GroupsService } from './groups'

class FakeMessenger extends EventEmitter {
  sent: Array<{ peerId: string; env: Envelope }> = []

  async sendUserMessage(peerId: string, env: Envelope): Promise<SendOutcome> {
    this.sent.push({ peerId, env })
    return 'sent'
  }

  async sendReliable(peerId: string, env: Envelope): Promise<boolean> {
    this.sent.push({ peerId, env })
    return true
  }
}

class FakeConvRepo {
  bump(): void {}
  incUnread(): void {}
  ensureGroup(groupId: string): string {
    return `group:${groupId}`
  }

  list(): ConversationView[] {
    return []
  }
}

class FakeGroupRepo {
  readonly rows = new Map<string, GroupMeta>()

  save(meta: GroupMeta): void {
    this.rows.set(meta.groupId, meta)
  }

  get(groupId: string): GroupMeta | undefined {
    return this.rows.get(groupId)
  }

  list(): GroupMeta[] {
    return [...this.rows.values()]
  }

  applyRemote(meta: GroupMeta): boolean {
    const local = this.rows.get(meta.groupId)
    if (
      local &&
      (meta.rev < local.rev || (meta.rev === local.rev && meta.updatedTs <= local.updatedTs))
    ) {
      return false
    }
    this.save(meta)
    return true
  }
}

function service(opts: {
  selfIp: string
  selfId?: string
  groupRepo?: FakeGroupRepo
  messenger?: FakeMessenger
}): GroupsService {
  return new GroupsService({
    selfId: opts.selfId ?? 'node-self',
    messenger: (opts.messenger ?? new FakeMessenger()) as unknown as Messenger,
    convRepo: new FakeConvRepo() as unknown as ConvRepo,
    msgRepo: { insert: () => false, get: () => undefined } as unknown as MsgRepo,
    groupRepo: (opts.groupRepo ?? new FakeGroupRepo()) as unknown as GroupRepo,
    getSelfIp: () => opts.selfIp
  })
}

describe('GroupsService 群管理权限', () => {
  it('无密码组允许创建者直接管理，其他成员不能管理', () => {
    const repo = new FakeGroupRepo()
    const owner = service({ selfIp: '10.0.0.1', groupRepo: repo })
    const group = owner.createGroup('项目组', ['node-bob'])
    expect(group?.creatorIp).toBe('10.0.0.1')
    expect(repo.get(group!.groupId)?.creatorId).toBe('node-self')
    expect(group?.hasAdminPassword).toBe(false)
    expect(group?.canManage).toBe(true)

    expect(owner.updateGroup(group!.groupId, { name: '项目组-改名' })?.name).toBe('项目组-改名')

    const movedIp = service({ selfIp: '10.0.0.2', groupRepo: repo })
    expect(movedIp.updateGroup(group!.groupId, { name: '换 IP 后仍可改名' })?.name).toBe(
      '换 IP 后仍可改名'
    )

    const otherMember = service({ selfId: 'node-bob', selfIp: '10.0.0.2', groupRepo: repo })
    expect(otherMember.updateGroup(group!.groupId, { name: '不应改名' })).toBeNull()
    expect(repo.get(group!.groupId)?.name).toBe('换 IP 后仍可改名')
  })

  it('有密码组必须输入正确密码才能管理，且不保存明文', () => {
    const repo = new FakeGroupRepo()
    const groups = service({ selfIp: '10.0.0.1', groupRepo: repo })
    const group = groups.createGroup('加密管理组', ['node-bob'], 's3cret', '项目代号')
    const meta = repo.get(group!.groupId)

    expect(group?.hasAdminPassword).toBe(true)
    expect(group?.adminHint).toBe('项目代号')
    expect(group?.canManage).toBe(false)
    expect(meta?.adminSecretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(meta?.adminSecretHash.includes('s3cret')).toBe(false)
    expect(meta?.adminHint).toBe('项目代号')

    expect(groups.updateGroup(group!.groupId, { name: '错误密码', adminPassword: 'bad' })).toBeNull()
    expect(groups.updateGroup(group!.groupId, { name: '正确密码', adminPassword: 's3cret' })?.name).toBe(
      '正确密码'
    )
  })

  it('远端 group.info 按创建 IP 校验；退组变更例外放行', () => {
    const repo = new FakeGroupRepo()
    const messenger = new FakeMessenger()
    service({ selfIp: '10.0.0.8', groupRepo: repo, messenger })
    const local: GroupMeta = {
      groupId: 'g-1',
      name: '项目组',
      members: ['node-self', 'node-bob'],
      rev: 1,
      updatedBy: 'node-self',
      updatedTs: 1000,
      creatorIp: '10.0.0.1',
      creatorId: 'node-self',
      adminSecretHash: '',
      adminHint: ''
    }
    repo.save(local)

    const unauthorized = makeEnvelope<GroupPayload>(MSG_TYPES.group, 'node-bob', {
      op: 'info',
      group: { ...local, name: '不应采纳', rev: 2, updatedBy: 'node-bob', updatedTs: 2000 }
    })
    messenger.emit('incoming', unauthorized, { address: '10.0.0.2' })
    expect(repo.get('g-1')?.name).toBe('项目组')

    const leave = makeEnvelope<GroupPayload>(MSG_TYPES.group, 'node-bob', {
      op: 'info',
      group: {
        ...local,
        members: ['node-self'],
        rev: 2,
        updatedBy: 'node-bob',
        updatedTs: 2000
      }
    })
    messenger.emit('incoming', leave, { address: '10.0.0.2' })
    expect(repo.get('g-1')?.members).toEqual(['node-self'])
  })

  it('远端 group.info 源 IP 不匹配时，创建者 nodeId 匹配仍可改名', () => {
    const repo = new FakeGroupRepo()
    const messenger = new FakeMessenger()
    service({ selfId: 'node-b', selfIp: '10.0.0.8', groupRepo: repo, messenger })
    const local: GroupMeta = {
      groupId: 'g-vm',
      name: '项目组',
      members: ['node-a', 'node-b'],
      rev: 1,
      updatedBy: 'node-a',
      updatedTs: 1000,
      creatorIp: '192.168.1.10',
      creatorId: 'node-a',
      adminSecretHash: '',
      adminHint: ''
    }
    repo.save(local)

    const rename = makeEnvelope<GroupPayload>(MSG_TYPES.group, 'node-a', {
      op: 'info',
      group: { ...local, name: '新群名', rev: 2, updatedBy: 'node-a', updatedTs: 2000 }
    })
    messenger.emit('incoming', rename, { address: '172.16.56.1' })
    expect(repo.get('g-vm')?.name).toBe('新群名')
  })
})

class FakeMsgRepo {
  inserted: Array<{ id: string; kind: string; content: string; convId: string }> = []
  insert(m: { id: string; kind: string; content: string; convId: string }): boolean {
    if (this.inserted.some((x) => x.id === m.id)) return false
    this.inserted.push(m)
    return true
  }
  get(id: string): { id: string; kind: string; content: string; convId: string } | undefined {
    return this.inserted.find((x) => x.id === id)
  }
}

function groupInfos(messenger: FakeMessenger): Envelope[] {
  return messenger.sent
    .filter((s) => s.env.type === 'group' && (s.env.payload as GroupPayload).op === 'info')
    .map((s) => s.env)
}

describe('GroupsService 群改名系统提示（决议 #87）', () => {
  function member(selfId: string, selfIp: string, displayName?: string) {
    const messenger = new FakeMessenger()
    const msgRepo = new FakeMsgRepo()
    const svc = new GroupsService({
      selfId,
      messenger: messenger as unknown as Messenger,
      convRepo: new FakeConvRepo() as unknown as ConvRepo,
      msgRepo: msgRepo as unknown as MsgRepo,
      groupRepo: new FakeGroupRepo() as unknown as GroupRepo,
      getSelfIp: () => selfIp,
      resolveDisplayName: displayName ? () => displayName : undefined
    })
    return { svc, messenger, msgRepo }
  }

  it('改名人自己看到“你把群名…”系统提示', () => {
    const a = member('node-a', '10.0.0.1')
    const g = a.svc.createGroup('茶水间', ['node-b'])!
    a.svc.updateGroup(g.groupId, { name: '午餐群' })
    const sys = a.msgRepo.inserted.filter((m) => m.kind === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0].content).toBe('你把群名「茶水间」改成了「午餐群」')
    expect(sys[0].convId).toBe(`group:${g.groupId}`)
  })

  it('远端成员收到改名 info 后本地生成系统提示并幂等', () => {
    const a = member('node-a', '10.0.0.1')
    const g = a.svc.createGroup('茶水间', ['node-b'])!
    a.svc.updateGroup(g.groupId, { name: '午餐群' })

    const b = member('node-b', '10.0.0.2', '阿明')
    const infos = groupInfos(a.messenger)
    // 依次投递建群(rev1)与改名(rev2)：首条让 B 认识群，第二条触发改名提示
    for (const env of infos) {
      b.messenger.emit('incoming', env, { address: '10.0.0.1' })
    }
    const sysB = b.msgRepo.inserted.filter((m) => m.kind === 'system')
    expect(sysB).toHaveLength(1)
    expect(sysB[0].content).toBe('阿明把群名「茶水间」改成了「午餐群」')

    // 幂等：重复投递改名 info 不再追加系统提示
    const renameInfo = infos[infos.length - 1]
    b.messenger.emit('incoming', renameInfo, { address: '10.0.0.1' })
    expect(b.msgRepo.inserted.filter((m) => m.kind === 'system')).toHaveLength(1)
  })

  it('首次入群（本地无该群）不误报改名提示', () => {
    const a = member('node-a', '10.0.0.1')
    a.svc.createGroup('研发组', ['node-b'])!
    const b = member('node-b', '10.0.0.2', '阿明')
    // 只投递建群 info（rev1）：B 首次认识该群，不应产生改名系统提示
    for (const env of groupInfos(a.messenger)) {
      b.messenger.emit('incoming', env, { address: '10.0.0.1' })
    }
    expect(b.msgRepo.inserted.filter((m) => m.kind === 'system')).toHaveLength(0)
  })
})
