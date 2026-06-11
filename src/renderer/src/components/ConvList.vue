<script setup lang="ts">
import { computed } from 'vue'
import { usePeersStore } from '../stores/peers'
import { useChatStore } from '../stores/chat'
import { listTime } from '../utils/time'

const peersStore = usePeersStore()
const chatStore = useChatStore()

const nickOf = computed(() => {
  const map = new Map<string, string>()
  for (const peer of peersStore.peers) map.set(peer.nodeId, peer.nick)
  return (peerId: string): string => map.get(peerId) ?? '未知节点'
})

function avatarText(peerId: string): string {
  return nickOf.value(peerId).slice(0, 1) || '?'
}
</script>

<template>
  <div class="pane">
    <div v-if="chatStore.convs.length === 0" class="placeholder">
      还没有会话<br />去「通讯录」找个人开聊
    </div>
    <ul v-else class="conv-list">
      <li
        v-for="conv in chatStore.convs"
        :key="conv.id"
        class="conv"
        :class="{ active: conv.id === chatStore.activeConvId }"
        @click="chatStore.openPeer(conv.peerId)"
      >
        <span class="conv-avatar">{{ avatarText(conv.peerId) }}</span>
        <span class="conv-main">
          <span class="row1">
            <span class="conv-name">{{ nickOf(conv.peerId) }}</span>
            <span class="conv-time">{{ listTime(conv.lastTs) }}</span>
          </span>
          <span class="row2">
            <span class="conv-preview">{{ conv.preview }}</span>
            <span v-if="conv.unread > 0" class="badge">{{
              conv.unread > 99 ? '99+' : conv.unread
            }}</span>
          </span>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.placeholder {
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
  margin-top: 24px;
  line-height: 1.8;
}
.conv-list {
  list-style: none;
  overflow-y: auto;
  flex: 1;
}
.conv {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.conv:hover {
  background: var(--line);
}
.conv.active {
  background: rgba(61, 139, 107, 0.12);
}
.conv-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 15px;
  flex-shrink: 0;
}
.conv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row1,
.row2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.conv-name {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-time {
  font-size: 11px;
  color: var(--text-3);
  flex-shrink: 0;
}
.conv-preview {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--badge);
  color: #fff;
  font-size: 11px;
  display: grid;
  place-items: center;
  padding: 0 5px;
  flex-shrink: 0;
}
</style>
