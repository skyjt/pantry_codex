import { defineStore } from 'pinia'
import type { UpdateAvailability } from '../../../shared/ipc'

// 局域网自更新提示（决议 #166 第一步：发现与提示）。
// 主进程在节点变化时推送当前可用更新源（同平台、版本更高、声明可作源的在线节点）；无则 null。
export const useUpdateStore = defineStore('update', {
  state: () => ({
    available: null as UpdateAvailability | null,
    initialized: false
  }),
  actions: {
    async init(): Promise<void> {
      if (this.initialized) return
      this.initialized = true
      this.available = await window.pantry.checkUpdate()
      window.pantry.onUpdateAvailable((info) => {
        this.available = info
      })
    }
  }
})
