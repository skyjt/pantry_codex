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
  groupRepo?: FakeGroupRepo
  messenger?: FakeMessenger
}): GroupsService {
  return new GroupsService({
    selfId: 'node-self',
    messenger: (opts.messenger ?? new FakeMessenger()) as unknown as Messenger,
    convRepo: new FakeConvRepo() as unknown as ConvRepo,
    msgRepo: {} as MsgRepo,
    groupRepo: (opts.groupRepo ?? new FakeGroupRepo()) as unknown as GroupRepo,
    getSelfIp: () => opts.selfIp
  })
}

describe('GroupsService 群管理权限', () => {
  it('无密码组只允许创建 IP 直接管理', () => {
    const repo = new FakeGroupRepo()
    const owner = service({ selfIp: '10.0.0.1', groupRepo: repo })
    const group = owner.createGroup('项目组', ['node-bob'])
    expect(group?.creatorIp).toBe('10.0.0.1')
    expect(group?.hasAdminPassword).toBe(false)
    expect(group?.canManage).toBe(true)

    expect(owner.updateGroup(group!.groupId, { name: '项目组-改名' })?.name).toBe('项目组-改名')

    const movedIp = service({ selfIp: '10.0.0.2', groupRepo: repo })
    expect(movedIp.updateGroup(group!.groupId, { name: '不应改名' })).toBeNull()
    expect(repo.get(group!.groupId)?.name).toBe('项目组-改名')
  })

  it('有密码组必须输入正确密码才能管理，且不保存明文', () => {
    const repo = new FakeGroupRepo()
    const groups = service({ selfIp: '10.0.0.1', groupRepo: repo })
    const group = groups.createGroup('加密管理组', ['node-bob'], 's3cret')
    const meta = repo.get(group!.groupId)

    expect(group?.hasAdminPassword).toBe(true)
    expect(group?.canManage).toBe(false)
    expect(meta?.adminSecretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(meta?.adminSecretHash.includes('s3cret')).toBe(false)

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
      adminSecretHash: ''
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
})
