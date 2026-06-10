import { defineStore } from 'pinia'
import type { PeerView } from '../../../shared/ipc'

// 主进程数据的只读投影（tech-design §7 状态流）
export const usePeersStore = defineStore('peers', {
  state: () => ({
    peers: [] as PeerView[],
    initialized: false
  }),
  getters: {
    onlineCount: (state) => state.peers.filter((p) => p.online).length
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
