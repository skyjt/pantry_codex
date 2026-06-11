import type { FileRefView, ForwardResult, ForwardTarget, MessageView } from '../../shared/ipc'
import type { FilesService } from './files'
import type { GroupsService } from './groups'
import type { ChatService } from './chat'
import type { MsgRepo, MsgRow } from '../store/msg-repo'

export interface ForwardDeps {
  msgRepo: MsgRepo
  chat: ChatService
  groups: GroupsService
  files: FilesService
}

// 转发编排：复用文本/群聊/文件服务，不新增线上协议。
export class ForwardService {
  constructor(private readonly deps: ForwardDeps) {}

  async forward(msgId: string, targets: ForwardTarget[]): Promise<ForwardResult> {
    const row = this.deps.msgRepo.get(msgId)
    const cleanTargets = this.normalizeTargets(targets)
    if (!row || !this.canForward(row)) return { ok: 0, total: cleanTargets.length, messages: [] }

    const messages: MessageView[] = []
    for (const target of cleanTargets) {
      const view = await this.forwardOne(row, target)
      if (view) messages.push(view)
    }
    return { ok: messages.length, total: cleanTargets.length, messages }
  }

  private normalizeTargets(targets: ForwardTarget[]): ForwardTarget[] {
    const seen = new Set<string>()
    const out: ForwardTarget[] = []
    for (const target of targets) {
      if ((target.type !== 'single' && target.type !== 'group') || !target.id) continue
      if (target.id.length > 64) continue
      const key = `${target.type}:${target.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(target)
      if (out.length >= 50) break
    }
    return out
  }

  private canForward(row: MsgRow): boolean {
    if (row.status === 'recalled') return false
    return row.kind === 'text' || row.kind === 'file' || row.kind === 'image' || row.kind === 'sticker'
  }

  private async forwardOne(row: MsgRow, target: ForwardTarget): Promise<MessageView | null> {
    if (row.kind === 'text') {
      return target.type === 'group'
        ? this.deps.groups.sendText(target.id, row.content)
        : this.deps.chat.sendText(target.id, row.content)
    }
    if (target.type !== 'single') return null
    const ref = this.parseFileRef(row.file_ref)
    if (!ref) return null
    const transfer = this.deps.files.transferView(ref.transferId)
    if (!transfer?.savedPath) return null
    const purpose = row.kind === 'image' || row.kind === 'sticker' ? row.kind : 'file'
    return this.deps.files.offerPaths(target.id, [transfer.savedPath], purpose)
  }

  private parseFileRef(raw: string | null): FileRefView | null {
    if (!raw) return null
    try {
      const ref = JSON.parse(raw) as FileRefView
      return typeof ref.transferId === 'string' && ref.transferId ? ref : null
    } catch {
      return null
    }
  }
}
