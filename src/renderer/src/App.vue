<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo } from '../../shared/ipc'

const info = ref<AppInfo | null>(null)

onMounted(async () => {
  info.value = await window.pantry.getAppInfo()
})
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
      <p class="placeholder">会话列表 · v0.1 开发中</p>
    </aside>

    <main class="content">
      <div class="empty">
        <div class="logo">茶话间</div>
        <p v-if="info" class="meta">
          v{{ info.version }} · Electron {{ info.electron }} · Chromium {{ info.chrome }} · Node
          {{ info.node }}
        </p>
        <p class="hint">脚手架就绪 —— 设计文档见 docs/</p>
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
  padding: 12px;
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
.placeholder {
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
  margin-top: 24px;
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
