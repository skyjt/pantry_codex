import { defineStore } from 'pinia'
import type { ConversationView, MessageView } from '../../../shared/ipc'

// 主进程聊天数据的投影 + 乐观更新（tech-design §7 状态流）
export const useChatStore = defineStore('chat', {
  state: () => ({
    convs: [] as ConversationView[],
    activeConvId: null as string | null,
    /** convId → 已加载消息（按 seq 升序） */
    messages: {} as Record<string, MessageView[]>,
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
    },

    /** 从通讯录或会话列表进入会话 */
    async openPeer(peerNodeId: string): Promise<void> {
      const conv = await window.pantry.openConversation(peerNodeId)
      if (!conv) return
      this.activeConvId = conv.id
      if (!this.messages[conv.id]) {
        this.messages[conv.id] = await window.pantry.pageMessages(conv.id, null, 50)
      }
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

    async send(text: string): Promise<boolean> {
      const conv = this.activeConv
      if (!conv) return false
      const view = await window.pantry.sendText(conv.peerId, text)
      if (!view) return false
      const list = (this.messages[conv.id] ??= [])
      if (!list.some((m) => m.id === view.id)) list.push(view)
      return true
    },

    async resend(msgId: string): Promise<void> {
      await window.pantry.resendMessage(msgId)
    }
  }
})
