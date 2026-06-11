<script setup lang="ts">
import { usePeersStore } from '../stores/peers'
import { useChatStore } from '../stores/chat'

const peersStore = usePeersStore()
const chatStore = useChatStore()

const emit = defineEmits<{ opened: [] }>()

function avatarText(nick: string): string {
  return nick.slice(0, 1) || '?'
}

async function open(nodeId: string): Promise<void> {
  await chatStore.openPeer(nodeId)
  emit('opened')
}
</script>

<template>
  <div class="pane">
    <div class="list-head">
      网内节点 {{ peersStore.peers.length }} · 在线 {{ peersStore.onlineCount }}
    </div>
    <div v-if="peersStore.peers.length === 0" class="placeholder">正在发现同网段节点…</div>
    <ul v-else class="peer-list">
      <li
        v-for="peer in peersStore.peers"
        :key="peer.nodeId"
        class="peer"
        :class="{ offline: !peer.online }"
        @click="open(peer.nodeId)"
      >
        <span class="peer-avatar">{{ avatarText(peer.nick) }}</span>
        <span class="peer-main">
          <span class="peer-name">
            {{ peer.nick }}
            <em v-if="!peer.online" class="offline-tag">· 离线</em>
          </span>
          <span class="peer-sub">{{ peer.ip }} · {{ peer.host }}</span>
        </span>
        <span class="dot" :class="peer.online ? 'on' : 'off'"></span>
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
.list-head {
  padding: 4px 12px 8px;
  font-size: 12px;
  color: var(--text-3);
}
.placeholder {
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
  margin-top: 24px;
}
.peer-list {
  list-style: none;
  overflow-y: auto;
  flex: 1;
}
.peer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
.peer:hover {
  background: var(--line);
}
.peer-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 14px;
  flex-shrink: 0;
}
.peer.offline .peer-avatar {
  background: var(--offline);
}
.peer-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.peer-name {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.peer.offline .peer-name {
  color: var(--text-3);
}
.offline-tag {
  font-style: normal;
  font-size: 12px;
  color: var(--text-3);
}
.peer-sub {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.on {
  background: var(--online);
}
.dot.off {
  background: var(--offline);
}
</style>
