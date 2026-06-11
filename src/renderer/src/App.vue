<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo } from '../../shared/ipc'
import { usePeersStore } from './stores/peers'
import { useChatStore } from './stores/chat'
import PeerList from './components/PeerList.vue'
import ConvList from './components/ConvList.vue'
import ChatPane from './components/ChatPane.vue'

type Tab = 'chat' | 'contacts'

const tab = ref<Tab>('chat')
const info = ref<AppInfo | null>(null)
const peersStore = usePeersStore()
const chatStore = useChatStore()

onMounted(async () => {
  void peersStore.init()
  void chatStore.init()
  info.value = await window.pantry.getAppInfo()
})
</script>

<template>
  <div class="shell">
    <nav class="rail">
      <div class="avatar">茶</div>
      <button
        class="rail-btn"
        :class="{ active: tab === 'chat' }"
        title="聊天"
        @click="tab = 'chat'"
      >
        💬
        <span v-if="chatStore.totalUnread > 0" class="rail-badge">{{
          chatStore.totalUnread > 99 ? '99+' : chatStore.totalUnread
        }}</span>
      </button>
      <button
        class="rail-btn"
        :class="{ active: tab === 'contacts' }"
        title="通讯录"
        @click="tab = 'contacts'"
      >
        👥
      </button>
      <div class="spacer"></div>
      <button class="rail-btn" title="设置（开发中）">⚙</button>
    </nav>

    <aside class="list">
      <div class="search-box"><input class="search" placeholder="搜索" disabled /></div>
      <ConvList v-if="tab === 'chat'" />
      <PeerList v-else @opened="tab = 'chat'" />
    </aside>

    <main class="content">
      <ChatPane v-if="chatStore.activeConv" />
      <div v-else class="empty">
        <div class="logo">茶话间</div>
        <p v-if="info" class="meta">
          v{{ info.version }} · Electron {{ info.electron }} · Chromium {{ info.chrome }} · Node
          {{ info.node }}
        </p>
        <p class="hint">在「通讯录」里选个人，开始第一句话</p>
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
  position: relative;
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
.rail-badge {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: var(--badge);
  color: #fff;
  font-size: 10px;
  display: grid;
  place-items: center;
  padding: 0 4px;
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

/* 栏③ 内容 */
.content {
  flex: 1;
  background: var(--bg-chat);
  display: grid;
}
.empty {
  place-self: center;
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
