import { defineStore } from 'pinia'
import type { PeerView } from '../../../shared/ipc'

// 主进程数据的只读投影（tech-design §7 状态流）
export const usePeersStore = defineStore('peers', {
  state: () => ({
    peers: [] as PeerView[],
    initialized: false
  }),
  getters: {
    onlineCount: (state) => state.peers.filter((p) => p.online).length,
    /** 统一显示名：备注优先于昵称（F-DISC-9） */
    nameOf: (state) => {
      const map = new Map<string, string>()
      for (const p of state.peers) map.set(p.nodeId, p.remark || p.nick)
      return (nodeId: string): string => map.get(nodeId) ?? '未知节点'
    },
    byId: (state) => {
      const map = new Map(state.peers.map((p) => [p.nodeId, p]))
      return (nodeId: string) => map.get(nodeId)
    }
  },
  actions: {
    async init(): Promise<void> {
      if (this.initialized) return
      this.initialized = true
      this.peers = await window.pantry.getPeers()
      window.pantry.onPeersUpdated((peers) => {
        this.peers = peers
      })
    }
  }
})
