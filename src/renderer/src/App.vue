<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo } from '../../shared/ipc'
import { usePeersStore } from './stores/peers'

const info = ref<AppInfo | null>(null)
const peersStore = usePeersStore()

onMounted(async () => {
  void peersStore.init()
  info.value = await window.pantry.getAppInfo()
})

function avatarText(nick: string): string {
  return nick.slice(0, 1) || '?'
}
</script>

<template>
  <div class="shell">
    <nav class="rail">
      <div class="avatar">茶</div>
      <button class="rail-btn active" title="聊天">💬</button>
      <button class="rail-btn" title="通讯录">👥</button>
      <div class="spacer"></div>
      <button class="rail-btn" title="设置">⚙</button>
    </nav>

    <aside class="list">
      <div class="search-box"><input class="search" placeholder="搜索" disabled /></div>
      <div class="list-head">网内节点 {{ peersStore.peers.length }} · 在线 {{ peersStore.onlineCount }}</div>
      <div v-if="peersStore.peers.length === 0" class="placeholder">正在发现同网段节点…</div>
      <ul v-else class="peer-list">
        <li v-for="peer in peersStore.peers" :key="peer.nodeId" class="peer" :class="{ offline: !peer.online }">
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
    </aside>

    <main class="content">
      <div class="empty">
        <div class="logo">茶话间</div>
        <p v-if="info" class="meta">
          v{{ info.version }} · Electron {{ info.electron }} · Chromium {{ info.chrome }} · Node
          {{ info.node }}
        </p>
        <p class="hint">v0.1 · 网络层已上线（发现/心跳/探活）—— 消息功能开发中</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
}

/* 栏① 导航 */
.rail {
  width: 56px;
  background: var(--primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 8px;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%; /* 决议：圆形头像 */
  background: var(--bg-window);
  color: var(--primary);
  display: grid;
  place-items: center;
  font-weight: 600;
  margin-bottom: 8px;
}
.rail-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  opacity: 0.7;
}
.rail-btn.active,
.rail-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  opacity: 1;
}
.spacer {
  flex: 1;
}

/* 栏② 列表 */
.list {
  width: 250px;
  background: var(--bg-list);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
}
.search-box {
  padding: 12px 12px 8px;
}
.search {
  width: 100%;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: var(--line);
  padding: 0 8px;
  font-size: 13px;
  outline: none;
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
  cursor: default;
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

/* 栏③ 内容 */
.content {
  flex: 1;
  background: var(--bg-chat);
  display: grid;
  place-items: center;
}
.empty {
  text-align: center;
  color: var(--text-3);
}
.logo {
  font-size: 28px;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 12px;
}
.meta {
  font-size: 13px;
  margin-bottom: 4px;
}
.hint {
  font-size: 12px;
}
</style>
