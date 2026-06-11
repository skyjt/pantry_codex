import { defineStore } from 'pinia'
import type { GroupView } from '../../../shared/ipc'

export const useGroupsStore = defineStore('groups', {
  state: () => ({
    byId: {} as Record<string, GroupView>,
    initialized: false
  }),
  getters: {
    nameOf: (state) => {
      return (groupId: string): string => state.byId[groupId]?.name ?? '讨论组'
    }
  },
  actions: {
    async init(): Promise<void> {
      if (this.initialized) return
      this.initialized = true
      for (const g of await window.pantry.listGroups()) this.byId[g.groupId] = g
      window.pantry.onGroupUpdated((g) => {
        this.byId[g.groupId] = g
      })
    },
    async ensure(groupId: string): Promise<void> {
      if (this.byId[groupId]) return
      const g = await window.pantry.getGroup(groupId)
      if (g) this.byId[groupId] = g
    }
  }
})
