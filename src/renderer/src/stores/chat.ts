import { defineStore } from 'pinia'
import type { ConversationView, ForwardResult, ForwardTarget, MessageView } from '../../../shared/ipc'

// 主进程聊天数据的投影 + 乐观更新（tech-design §7 状态流）
export const useChatStore = defineStore('chat', {
  state: () => ({
    convs: [] as ConversationView[],
    activeConvId: null as string | null,
    /** convId → 已加载消息（按 seq 升序） */
    messages: {} as Record<string, MessageView[]>,
    /** 搜索跳转后的高亮目标（短暂） */
    highlightId: null as string | null,
    /** 正在查看历史窗口（非最新页）——显示"回到最新"按钮 */
    viewingHistory: false,
    selfId: '',
    initialized: false
  }),
  getters: {
    activeConv(state): ConversationView | null {
      return state.convs.find((c) => c.id === state.activeConvId) ?? null
    },
    activeMessages(state): MessageView[] {
      return state.activeConvId ? (state.messages[state.activeConvId] ?? []) : []
    },
    totalUnread(state): number {
      return state.convs.reduce((sum, c) => sum + c.unread, 0)
    }
  },
  actions: {
    async init(): Promise<void> {
      if (this.initialized) return
      this.initialized = true
      this.convs = await window.pantry.listConversations()
      this.selfId = (await window.pantry.getAppInfo()).nodeId

      window.pantry.onConvsUpdated((convs) => {
        this.convs = convs
      })
      window.pantry.onMsgNew((msg) => {
        const list = this.messages[msg.convId]
        if (list && !list.some((m) => m.id === msg.id)) list.push(msg)
        if (msg.convId === this.activeConvId) void window.pantry.markRead(msg.convId)
      })
      window.pantry.onMsgStatus((event) => {
        const target = this.messages[event.convId]?.find((m) => m.id === event.id)
        if (target) target.status = event.status
      })
      // 点系统通知/托盘 → 直达对应会话（F-SYS-2），单聊群聊通用
      window.pantry.onOpenConv((convId) => {
        void this.openConv(convId)
      })
      // 截图选择"发送"：发到当前会话（无可发送会话则只留在剪贴板）
      window.pantry.onCaptured((bytes) => {
        const conv = this.activeConv
        if (conv) void this.sendImageBytes('截图.png', bytes)
      })
    },

    /** 从通讯录或会话列表进入会话 */
    async openPeer(peerNodeId: string): Promise<void> {
      const conv = await window.pantry.openConversation(peerNodeId)
      if (!conv) return
      this.upsertConversation(conv)
      this.activeConvId = conv.id
      this.viewingHistory = false
      if (!this.messages[conv.id]) {
        this.messages[conv.id] = await window.pantry.pageMessages(conv.id, null, 50)
      }
    },

    /** 按会话 id 打开（群会话 / 通知跳转通用） */
    async openConv(convId: string): Promise<void> {
      if (convId.startsWith('single:')) {
        await this.openPeer(convId.slice(7))
        return
      }
      this.activeConvId = convId
      this.viewingHistory = false
      if (!this.messages[convId]) {
        this.messages[convId] = await window.pantry.pageMessages(convId, null, 50)
      }
      await window.pantry.markRead(convId)
    },

    /** 搜索结果跳转：载入目标前后窗口并短暂高亮（ui-design §6） */
    async jumpToMessage(convId: string, seq: number, msgId: string): Promise<void> {
      if (convId.startsWith('single:')) {
        const conv = await window.pantry.openConversation(convId.slice(7))
        if (!conv) return
      } else {
        await window.pantry.markRead(convId)
      }
      this.activeConvId = convId
      this.messages[convId] = await window.pantry.getMessageContext(convId, seq)
      this.viewingHistory = true
      this.highlightId = msgId || null
      setTimeout(() => {
        if (this.highlightId === msgId) this.highlightId = null
      }, 2600)
    },

    async backToLatest(): Promise<void> {
      const convId = this.activeConvId
      if (!convId) return
      this.messages[convId] = await window.pantry.pageMessages(convId, null, 50)
      this.viewingHistory = false
    },

    upsertConversation(conv: ConversationView): void {
      const index = this.convs.findIndex((item) => item.id === conv.id)
      if (index >= 0) this.convs[index] = conv
      else this.convs = [conv, ...this.convs]
    },

    async pinConversation(convId: string, pinned: boolean): Promise<void> {
      await window.pantry.pinConversation(convId, pinned)
    },

    async muteConversation(convId: string, muted: boolean): Promise<void> {
      await window.pantry.muteConversation(convId, muted)
    },

    async removeConversation(convId: string): Promise<void> {
      await window.pantry.removeConversation(convId)
      if (this.activeConvId === convId) this.activeConvId = null
      delete this.messages[convId]
    },

    async loadEarlier(): Promise<number> {
      const convId = this.activeConvId
      if (!convId) return 0
      const list = this.messages[convId] ?? []
      const before = list.length > 0 ? list[0].seq : null
      const earlier = await window.pantry.pageMessages(convId, before, 50)
      this.messages[convId] = [...earlier, ...list]
      return earlier.length
    },

    async send(text: string, mentions: string[] = []): Promise<boolean> {
      const conv = this.activeConv
      if (!conv) return false
      const view =
        conv.type === 'group'
          ? await window.pantry.sendGroupText(conv.peerId, text, mentions)
          : await window.pantry.sendText(conv.peerId, text)
      if (!view) return false
      const list = (this.messages[conv.id] ??= [])
      if (!list.some((m) => m.id === view.id)) list.push(view)
      return true
    },

    async resend(msgId: string): Promise<void> {
      await window.pantry.resendMessage(msgId)
    },

    async recall(msgId: string): Promise<boolean> {
      return window.pantry.recallMessage(msgId)
    },

    async forward(msgId: string, targets: ForwardTarget[]): Promise<ForwardResult> {
      const result = await window.pantry.forwardMessage(msgId, targets)
      for (const msg of result.messages) {
        const list = this.messages[msg.convId]
        if (list && !list.some((m) => m.id === msg.id)) list.push(msg)
      }
      return result
    },

    /** 发文件（选择器或拖拽）；对方离线时主进程返回 null（决议 #4） */
    async sendFilePaths(paths: string[]): Promise<boolean> {
      const conv = this.activeConv
      if (!conv) return false
      const view =
        conv.type === 'group'
          ? await window.pantry.offerGroupFiles(conv.peerId, paths)
          : await window.pantry.offerFiles(conv.peerId, paths)
      return this.pushOwn(view)
    },

    /** 磁盘图片按图片消息发送（拖拽图片/选择器） */
    async sendImagePath(path: string): Promise<boolean> {
      const conv = this.activeConv
      if (!conv) return false
      const view =
        conv.type === 'group'
          ? await window.pantry.offerGroupImagePath(conv.peerId, path)
          : await window.pantry.offerImagePath(conv.peerId, path)
      return this.pushOwn(view)
    },

    /** 粘贴的图片字节（截图 Ctrl+V） */
    async sendImageBytes(name: string, bytes: ArrayBuffer): Promise<boolean> {
      const conv = this.activeConv
      if (!conv) return false
      const view =
        conv.type === 'group'
          ? await window.pantry.sendGroupImageBytes(conv.peerId, name, bytes)
          : await window.pantry.sendImageBytes(conv.peerId, name, bytes)
      return this.pushOwn(view)
    },

    /** 发送收藏的表情包（仅单聊，传输与图片同通道） */
    async sendSticker(stickerId: string): Promise<boolean> {
      const conv = this.activeConv
      if (!conv || conv.type === 'group') return false
      const view = await window.pantry.sendSticker(conv.peerId, stickerId)
      return this.pushOwn(view)
    },

    pushOwn(view: MessageView | null): boolean {
      const conv = this.activeConv
      if (!view || !conv) return false
      const list = (this.messages[conv.id] ??= [])
      if (!list.some((m) => m.id === view.id)) list.push(view)
      return true
    }
  }
})
