import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MSG_TYPES, type Envelope, type FileCtlPayload, type GroupMeta } from '../../shared/protocol'
import type { ConversationView } from '../../shared/ipc'
import type { Messenger } from '../net/messenger'
import type { PeerRegistry } from '../net/peer-registry'
import type { ConvRepo } from '../store/conv-repo'
import type { GroupRepo } from '../store/group-repo'
import type { MsgRepo, MsgRow, NewMessage } from '../store/msg-repo'
import type { TransferRepo, TransferRow } from '../store/transfer-repo'
import { FilesService } from './files'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

class FakeMessenger extends EventEmitter {
  sent: Array<{ peerId: string; env: Envelope<FileCtlPayload> }> = []

  async sendReliable(peerId: string, env: Envelope<FileCtlPayload>): Promise<boolean> {
    this.sent.push({ peerId, env })
    return true
  }
}

class FakeRegistry {
  constructor(private readonly onlineIds: string[]) {}

  get(nodeId: string): unknown {
    if (!this.onlineIds.includes(nodeId)) return undefined
    return {
      online: true,
      ip: '127.0.0.1',
      udpPort: 17878,
      profile: { tcpPort: 17879 }
    }
  }
}

class FakeConvRepo {
  bumped: Array<{ convId: string; ts: number }> = []

  ensureSingle(peerId: string): string {
    return `single:${peerId}`
  }

  ensureGroup(groupId: string): string {
    return `group:${groupId}`
  }

  bump(convId: string, ts: number): void {
    this.bumped.push({ convId, ts })
  }

  incUnread(): void {
    // no-op
  }

  list(): ConversationView[] {
    return []
  }
}

class FakeMsgRepo {
  rows = new Map<string, MsgRow>()

  insert(msg: NewMessage): boolean {
    this.rows.set(msg.id, {
      id: msg.id,
      conv_id: msg.convId,
      sender_id: msg.senderId,
      is_mine: msg.isMine ? 1 : 0,
      kind: msg.kind,
      content: msg.content,
      file_ref: msg.fileRef ?? null,
      ts: msg.ts,
      seq: this.rows.size + 1,
      status: msg.status
    })
    return true
  }

  get(msgId: string): MsgRow | undefined {
    return this.rows.get(msgId)
  }

  updateStatus(msgId: string, status: string): void {
    const row = this.rows.get(msgId)
    if (row) row.status = status
  }
}

class FakeTransferRepo {
  rows = new Map<string, TransferRow>()

  resetActive(): number {
    return 0
  }

  insert(row: {
    transferId: string
    msgId: string
    peerId: string
    direction: 'in' | 'out'
    files: string
    status: string
    total: number
    ts: number
  }): void {
    this.rows.set(row.transferId, {
      transfer_id: row.transferId,
      msg_id: row.msgId,
      peer_id: row.peerId,
      direction: row.direction,
      files: row.files,
      status: row.status,
      bytes_done: 0,
      total: row.total,
      ts: row.ts
    })
  }

  updateStatus(transferId: string, status: string): void {
    const row = this.rows.get(transferId)
    if (row) row.status = status
  }

  updateProgress(): void {
    // no-op
  }

  updateFiles(): void {
    // no-op
  }

  get(transferId: string): TransferRow | undefined {
    return this.rows.get(transferId)
  }

  list(): TransferRow[] {
    return [...this.rows.values()]
  }
}

class FakeGroupRepo {
  constructor(private readonly meta: GroupMeta) {}

  get(groupId: string): GroupMeta | undefined {
    return groupId === this.meta.groupId ? this.meta : undefined
  }
}

function waitTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('FilesService 群聊媒体', () => {
  it('群文件发送只投递在线成员，并在本端只插入一条群消息', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-files-service-'))
    tmpDirs.push(dir)
    const filePath = join(dir, '群文件.txt')
    writeFileSync(filePath, 'hello group')

    const messenger = new FakeMessenger()
    const msgRepo = new FakeMsgRepo()
    const transferRepo = new FakeTransferRepo()
    const group: GroupMeta = {
      groupId: 'group-1',
      name: '项目组',
      members: ['node-self', 'node-bob', 'node-carol', 'node-dan'],
      rev: 3,
      updatedBy: 'node-self',
      updatedTs: 1000,
      creatorIp: '127.0.0.1',
      adminSecretHash: '',
      adminHint: ''
    }
    const service = new FilesService({
      selfId: 'node-self',
      messenger: messenger as unknown as Messenger,
      registry: new FakeRegistry(['node-bob', 'node-dan']) as unknown as PeerRegistry,
      convRepo: new FakeConvRepo() as unknown as ConvRepo,
      msgRepo: msgRepo as unknown as MsgRepo,
      transferRepo: transferRepo as unknown as TransferRepo,
      groupRepo: new FakeGroupRepo(group) as unknown as GroupRepo,
      tcpPort: 0,
      getSaveDir: () => dir,
      getImagesDir: () => dir,
      bindAddress: '127.0.0.1'
    })

    const view = await service.offerGroupPaths('group-1', [filePath])
    expect(view?.convId).toBe('group:group-1')
    expect(view?.fileRef?.transferIds).toHaveLength(2)
    expect(msgRepo.rows.size).toBe(1)
    expect(transferRepo.rows.size).toBe(2)

    await waitTick()
    expect(messenger.sent.map((item) => item.peerId).sort()).toEqual(['node-bob', 'node-dan'])
    for (const item of messenger.sent) {
      expect(item.env.type).toBe(MSG_TYPES.fileCtl)
      expect(item.env.payload).toMatchObject({
        op: 'offer',
        groupId: 'group-1',
        groupRev: 3,
        rootName: '群文件.txt'
      })
    }
    expect(msgRepo.get(view!.id)?.status).toBe('sent')
  })

  it('群聊图片不超过 10MB 时按图片 offer 投递', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-files-service-'))
    tmpDirs.push(dir)
    const filePath = join(dir, '群图片.png')
    writeFileSync(filePath, 'small image')

    const messenger = new FakeMessenger()
    const msgRepo = new FakeMsgRepo()
    const transferRepo = new FakeTransferRepo()
    const group: GroupMeta = {
      groupId: 'group-1',
      name: '项目组',
      members: ['node-self', 'node-bob'],
      rev: 3,
      updatedBy: 'node-self',
      updatedTs: 1000,
      creatorIp: '127.0.0.1',
      adminSecretHash: '',
      adminHint: ''
    }
    const service = new FilesService({
      selfId: 'node-self',
      messenger: messenger as unknown as Messenger,
      registry: new FakeRegistry(['node-bob']) as unknown as PeerRegistry,
      convRepo: new FakeConvRepo() as unknown as ConvRepo,
      msgRepo: msgRepo as unknown as MsgRepo,
      transferRepo: transferRepo as unknown as TransferRepo,
      groupRepo: new FakeGroupRepo(group) as unknown as GroupRepo,
      tcpPort: 0,
      getSaveDir: () => dir,
      getImagesDir: () => dir,
      bindAddress: '127.0.0.1'
    })

    const view = await service.offerGroupPaths('group-1', [filePath], 'image')
    expect(view?.kind).toBe('image')

    await waitTick()
    expect(messenger.sent[0].env.payload).toMatchObject({
      op: 'offer',
      purpose: 'image',
      groupId: 'group-1'
    })
  })

  it('群聊图片超过 10MB 时退化为普通文件，等待成员手动接收', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pantry-files-service-'))
    tmpDirs.push(dir)
    const filePath = join(dir, '超限群图片.png')
    writeFileSync(filePath, '')
    truncateSync(filePath, 10 * 1024 * 1024 + 1)

    const messenger = new FakeMessenger()
    const msgRepo = new FakeMsgRepo()
    const transferRepo = new FakeTransferRepo()
    const group: GroupMeta = {
      groupId: 'group-1',
      name: '项目组',
      members: ['node-self', 'node-bob'],
      rev: 3,
      updatedBy: 'node-self',
      updatedTs: 1000,
      creatorIp: '127.0.0.1',
      adminSecretHash: '',
      adminHint: ''
    }
    const service = new FilesService({
      selfId: 'node-self',
      messenger: messenger as unknown as Messenger,
      registry: new FakeRegistry(['node-bob']) as unknown as PeerRegistry,
      convRepo: new FakeConvRepo() as unknown as ConvRepo,
      msgRepo: msgRepo as unknown as MsgRepo,
      transferRepo: transferRepo as unknown as TransferRepo,
      groupRepo: new FakeGroupRepo(group) as unknown as GroupRepo,
      tcpPort: 0,
      getSaveDir: () => dir,
      getImagesDir: () => dir,
      bindAddress: '127.0.0.1'
    })

    const view = await service.offerGroupPaths('group-1', [filePath], 'image')
    expect(view?.kind).toBe('file')
    expect(view?.text).toBe('[文件] 超限群图片.png')

    await waitTick()
    expect(messenger.sent[0].env.payload).toMatchObject({
      op: 'offer',
      groupId: 'group-1'
    })
    expect('purpose' in messenger.sent[0].env.payload).toBe(false)
    expect([...transferRepo.rows.values()][0].status).toBe('offering')
  })
})
