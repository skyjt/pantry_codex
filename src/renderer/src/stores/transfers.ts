import { defineStore } from 'pinia'
import type { TransferView } from '../../../shared/ipc'

interface SpeedSample {
  bytes: number
  ts: number
}

// 文件卡片的数据源：主进程传输状态投影 + 本地测速
export const useTransfersStore = defineStore('transfers', {
  state: () => ({
    byId: {} as Record<string, TransferView>,
    speed: {} as Record<string, number>,
    samples: {} as Record<string, SpeedSample>,
    initialized: false
  }),
  actions: {
    init(): void {
      if (this.initialized) return
      this.initialized = true
      window.pantry.onTransferUpdated((view) => {
        const prev = this.samples[view.transferId]
        const now = Date.now()
        if (view.status === 'accepted' && prev && now > prev.ts) {
          this.speed[view.transferId] =
            ((view.bytesDone - prev.bytes) / (now - prev.ts)) * 1000
        } else if (view.status !== 'accepted') {
          this.speed[view.transferId] = 0
        }
        this.samples[view.transferId] = { bytes: view.bytesDone, ts: now }
        this.byId[view.transferId] = view
      })
    },
    /** 文件消息渲染时懒加载（历史消息的卡片状态） */
    async ensure(transferId: string): Promise<void> {
      if (this.byId[transferId]) return
      const view = await window.pantry.getTransfer(transferId)
      if (view) this.byId[transferId] = view
    },
    accept(transferId: string, saveAs = false): void {
      void window.pantry.acceptTransfer(transferId, saveAs)
    },
    decline(transferId: string): void {
      void window.pantry.declineTransfer(transferId)
    },
    cancel(transferId: string): void {
      void window.pantry.cancelTransfer(transferId)
    },
    reveal(transferId: string): void {
      void window.pantry.revealTransfer(transferId)
    }
  }
})

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
