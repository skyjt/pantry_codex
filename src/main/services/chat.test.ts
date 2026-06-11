import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Envelope, GroupMeta, MsgPayload } from '../../shared/protocol'
import type { ConversationView } from '../../shared/ipc'
import { ChatService } from './chat'
import type { Messenger, SendOutcome } from '../net/messenger'
import type { ConvRepo } from '../store/conv-repo'
import type { GroupRepo } from '../store/group-repo'
import type { MsgRepo, MsgRow, NewMessage } from '../store/msg-repo'

class FakeMessenger extends EventEmitter {
  sent: Array<{ peerId: string; env: Envelope<MsgPayload> }> = []
  dropped: Array<{ msgId: string; peerIds: string[] }> = []

  async sendUserMessage(peerId: string, env: Envelope<MsgPayload>): Promise<SendOutcome> {
    this.sent.push({ peerId, env })
    return 'queued'
  }

  dropQueuedMessage(msgId: string, peerIds: string[]): void {
    this.dropped.push({ msgId, peerIds })
  }

  prune(): Array<{ msgId: string; peerId: string }> {
    return []
  }
}

class FakeMsgRepo {
  rows = new Map<string, MsgRow>()
  inserted: NewMessage[] = []

  get(msgId: string): MsgRow | undefined {
    return this.rows.get(msgId)
  }

  insert(msg: NewMessage): boolean {
    this.inserted.push(msg)
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

  recall(msgId: string): boolean {
    const row = this.rows.get(msgId)
    if (!row) return false
    row.status = 'recalled'
    row.content = ''
    row.file_ref = null
    return true
  }

  updateStatus(msgId: string, status: MsgRow['status']): void {
    const row = this.rows.get(msgId)
    if (row) row.status = status
  }

  resetStaleSending(): number {
    return 0
  }
}

class FakeConvRepo {
  bumped: Array<{ convId: string; ts: number }> = []
  unread: string[] = []

  bump(convId: string, ts: number): void {
    this.bumped.push({ convId, ts })
  }

  incUnread(convId: string): void {
    this.unread.push(convId)
  }

  list(): ConversationView[] {
    return []
  }
}

class FakeGroupRepo {
  constructor(private readonly meta: GroupMeta | null = null) {}

  get(): GroupMeta | null {
    return this.meta
  }
}

function makeRow(overrides: Partial<MsgRow> = {}): MsgRow {
  return {
    id: 'msg-original',
    conv_id: 'single:node-peer',
    sender_id: 'node-self',
    is_mine: 1,
    kind: 'text',
    content: '准备撤回的内容',
    file_ref: null,
    ts: Date.now(),
    seq: 1,
    status: 'queued',
    ...overrides
  }
}

describe('ChatService 撤回', () => {
  it('撤回已排队的单聊消息时，先移除原文补发队列再发送 recall 指令', async () => {
    const msgRepo = new FakeMsgRepo()
    msgRepo.rows.set('msg-original', makeRow())
    const messenger = new FakeMessenger()
    const chat = new ChatService({
      selfId: 'node-self',
      convRepo: new FakeConvRepo() as unknown as ConvRepo,
      msgRepo: msgRepo as unknown as MsgRepo,
      groupRepo: new FakeGroupRepo() as unknown as GroupRepo,
      messenger: messenger as unknown as Messenger
    })

    expect(chat.recall('msg-original')).toBe(true)

    expect(messenger.dropped).toEqual([{ msgId: 'msg-original', peerIds: ['node-peer'] }])
    expect(messenger.sent).toHaveLength(1)
    expect(messenger.sent[0].peerId).toBe('node-peer')
    expect(messenger.sent[0].env.payload).toMatchObject({
      kind: 'recall',
      targetId: 'msg-original'
    })
    expect(msgRepo.get('msg-original')?.status).toBe('recalled')
    expect(msgRepo.get('msg-original')?.content).toBe('')
    expect(msgRepo.inserted[0]).toMatchObject({
      convId: 'single:node-peer',
      kind: 'system',
      content: '你撤回了一条消息',
      status: 'sent'
    })
  })
})
