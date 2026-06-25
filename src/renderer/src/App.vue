<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { AppInfo, ScanProgressView, SettingsView } from '../../shared/ipc'
import { usePeersStore } from './stores/peers'
import { useChatStore } from './stores/chat'
import PeerList from './components/PeerList.vue'
import ConvList from './components/ConvList.vue'
import ChatPane from './components/ChatPane.vue'
import SetupWizard from './components/SetupWizard.vue'
import SearchPanel from './components/SearchPanel.vue'
import ProfileCard from './components/ProfileCard.vue'
import GroupCreator from './components/GroupCreator.vue'
// 群发功能已停用（决议 #62）：建讨论组即可满足同样诉求，群发无实际意义；保留代码留痕。
// import MassSender from './components/MassSender.vue'
import PantryIcon from './components/PantryIcon.vue'
import PantryBrandLogo from './components/PantryBrandLogo.vue'
import WindowControls from './components/WindowControls.vue'
import WindowDragStrip from './components/WindowDragStrip.vue'
import { useGroupsStore } from './stores/groups'
import type { PeerView } from '../../shared/ipc'
import { applyAppearance } from './utils/appearance'
import AvatarMark from './components/AvatarMark.vue'
import { randomQuote } from './utils/quotes'

type Tab = 'chat' | 'contacts'

const tab = ref<Tab>('chat')
const searchQuery = ref('')
const selectedPeerId = ref<string | null>(null)
const showGroupCreator = ref(false)
// const showMassSender = ref(false) // 群发已停用（决议 #62）
const groupsStore = useGroupsStore()

const selectedPeer = computed<PeerView | null>(() =>
  selectedPeerId.value ? (peersStore.byId(selectedPeerId.value) ?? null) : null
)

function onSelectPeer(peer: PeerView): void {
  selectedPeerId.value = peer.nodeId
}

async function chatWith(nodeId: string): Promise<void> {
  await chatStore.openPeer(nodeId)
  selectedPeerId.value = null
  tab.value = 'chat'
}

function openSettings(event?: Event): void {
  releaseRailFocus(event)
  void window.pantry.openSettings()
}
const info = ref<AppInfo | null>(null)
// 主界面空态随机名言（决议 #82）：组件创建（每次打开软件）时随机一条，纯本地内置
const quote = ref(randomQuote())
const settings = ref<SettingsView | null>(null)
const showWizard = ref(false)
const peersStore = usePeersStore()
const chatStore = useChatStore()
let stopSettings: (() => void) | null = null
let stopScanProgress: (() => void) | null = null
let scanProgressHideTimer: ReturnType<typeof setTimeout> | null = null
let railHintTimer: ReturnType<typeof setTimeout> | null = null
let railFocusReleaseTimer: ReturnType<typeof setTimeout> | null = null
let pendingRailHint: string | null = null

const scanProgress = ref<ScanProgressView>({
  scanId: 0,
  status: 'idle',
  running: false,
  done: 0,
  total: 0,
  rangeCount: 0,
  startedAt: 0,
  finishedAt: 0
})
const scanProgressVisible = ref(false)
const hasScanRanges = computed(() => (settings.value?.scanRanges.length ?? 0) > 0)
const canScanAllRanges = computed(() => hasScanRanges.value && !scanProgress.value.running)
const scanPercent = computed(() => {
  const total = scanProgress.value.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((scanProgress.value.done / total) * 100)))
})
const scanButtonTitle = computed(() => {
  if (scanProgress.value.running) {
    return `扫描中 ${scanProgress.value.done}/${scanProgress.value.total}`
  }
  if (!hasScanRanges.value) return '没有已保存扫描网段'
  return '刷新全局用户'
})
const scanProgressTitle = computed(() => `扫描进度 ${scanPercent.value}%`)
const selfName = computed(() => settings.value?.nick.trim() || '未设置昵称')
const selfOrgPath = computed(() => {
  const parts = [settings.value?.company, settings.value?.dept, settings.value?.team]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
  return parts.length > 0 ? parts.join(' / ') : '未设置组织信息'
})
const selfPortText = computed(() => {
  if (!settings.value) return '端口未加载'
  return `端口 UDP ${settings.value.udpPort} / TCP ${settings.value.tcpPort}`
})
const selfHostText = computed(() => settings.value?.host.trim() || '主机名未加载')
const selfNodeShort = computed(() => info.value?.nodeId.slice(0, 8) ?? '加载中')
const activeRailHint = ref<string | null>(null)

function applyWindowTitle(next: SettingsView | null): void {
  const nick = next?.setupDone ? next.nick.trim() : ''
  document.title = nick ? `${nick}-🍵Teahouse` : '茶话间'
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') chatStore.forgetConversationScrolls()
}

function clearScanProgressHideTimer(): void {
  if (scanProgressHideTimer) clearTimeout(scanProgressHideTimer)
  scanProgressHideTimer = null
}

function clearRailHintTimer(): void {
  if (railHintTimer) clearTimeout(railHintTimer)
  railHintTimer = null
  pendingRailHint = null
}

function scheduleRailHint(key: string): void {
  if (activeRailHint.value === key || pendingRailHint === key) return
  clearRailHintTimer()
  pendingRailHint = key
  railHintTimer = setTimeout(() => {
    activeRailHint.value = key
    clearRailHintTimer()
  }, 520)
}

function hideRailHint(key?: string): void {
  clearRailHintTimer()
  if (!key || activeRailHint.value === key) activeRailHint.value = null
}

function clearRailFocusReleaseTimer(): void {
  if (railFocusReleaseTimer) clearTimeout(railFocusReleaseTimer)
  railFocusReleaseTimer = null
}

function releaseRailFocus(event?: Event): void {
  const eventTarget = event?.currentTarget
  if (eventTarget instanceof HTMLElement) eventTarget.blur()

  const active = document.activeElement
  if (active instanceof HTMLElement && active.classList.contains('rail-btn')) active.blur()
}

function releaseInitialRailFocus(): void {
  clearRailFocusReleaseTimer()
  void nextTick(() => {
    requestAnimationFrame(() => {
      releaseRailFocus()
      railFocusReleaseTimer = setTimeout(() => {
        releaseRailFocus()
        railFocusReleaseTimer = null
      }, 0)
    })
  })
}

function applyScanProgress(next: ScanProgressView): void {
  scanProgress.value = next
  clearScanProgressHideTimer()
  if (next.running) {
    scanProgressVisible.value = true
    return
  }
  if (next.status === 'done' && next.total > 0) {
    scanProgressVisible.value = true
    scanProgressHideTimer = setTimeout(() => {
      scanProgressVisible.value = false
      scanProgressHideTimer = null
    }, 2200)
    return
  }
  scanProgressVisible.value = false
}

function activateTab(next: Tab, event: Event): void {
  tab.value = next
  hideRailHint()
  releaseRailFocus(event)
}

async function refreshAllUsers(event?: Event): Promise<void> {
  releaseRailFocus(event)
  if (!canScanAllRanges.value) return
  applyScanProgress(await window.pantry.scanAllRanges())
}

onMounted(async () => {
  void peersStore.init()
  void chatStore.init()
  void groupsStore.init()
  document.addEventListener('visibilitychange', onVisibilityChange)
  info.value = await window.pantry.getAppInfo()
  settings.value = await window.pantry.getSettings()
  applyAppearance(settings.value)
  applyWindowTitle(settings.value)
  showWizard.value = settings.value !== null && !settings.value.setupDone
  stopSettings = window.pantry.onSettingsUpdated((next) => {
    settings.value = next
    applyAppearance(next)
    applyWindowTitle(next)
  })
  stopScanProgress = window.pantry.onScanProgress(applyScanProgress)
  releaseInitialRailFocus()
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopSettings?.()
  stopScanProgress?.()
  clearScanProgressHideTimer()
  hideRailHint()
  clearRailFocusReleaseTimer()
})
</script>

<template>
  <SetupWizard v-if="showWizard && settings" :settings="settings" @done="showWizard = false" />
  <!-- 沉浸式无标题栏（决议 #49/#52）：顶部 32px 隐形拖拽带 + Win/Linux 自绘窗口控制按钮 -->
  <WindowDragStrip />
  <WindowControls />
  <div class="shell">
    <nav class="rail">
      <div class="avatar-wrap" aria-label="我的信息">
        <AvatarMark
          class="avatar"
          :avatar="settings?.avatar ?? -1"
          :name="settings?.nick ?? '茶'"
        />
        <div class="self-card" aria-hidden="true">
          <div class="self-card-head">
            <AvatarMark
              class="self-card-avatar"
              :avatar="settings?.avatar ?? -1"
              :name="settings?.nick ?? '茶'"
            />
            <div class="self-card-title">
              <div class="self-card-name">{{ selfName }}</div>
              <div class="self-card-subtitle">本机资料</div>
            </div>
          </div>
          <div class="self-card-body">
            <div class="self-card-row">
              <span class="self-card-label">组织</span>
              <span class="self-card-value">{{ selfOrgPath }}</span>
            </div>
            <div class="self-card-grid">
              <div class="self-card-tile">
                <span class="self-card-label">主机</span>
                <span class="self-card-value">{{ selfHostText }}</span>
              </div>
              <div class="self-card-tile">
                <span class="self-card-label">节点</span>
                <span class="self-card-value">ID {{ selfNodeShort }}</span>
              </div>
            </div>
            <div class="self-card-row">
              <span class="self-card-label">端口</span>
              <span class="self-card-value">{{ selfPortText }}</span>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="rail-btn rail-hint"
        :class="{ active: tab === 'chat', 'show-hint': activeRailHint === 'chat' }"
        data-label="聊天"
        aria-label="聊天"
        @pointermove="scheduleRailHint('chat')"
        @pointerleave="hideRailHint('chat')"
        @click="activateTab('chat', $event)"
      >
        <PantryIcon name="chat" :size="25" />
        <span v-if="chatStore.totalUnread > 0" class="rail-badge">{{
          chatStore.totalUnread > 99 ? '99+' : chatStore.totalUnread
        }}</span>
      </button>
      <button
        type="button"
        class="rail-btn rail-hint"
        :class="{ active: tab === 'contacts', 'show-hint': activeRailHint === 'contacts' }"
        data-label="通讯录"
        aria-label="通讯录"
        @pointermove="scheduleRailHint('contacts')"
        @pointerleave="hideRailHint('contacts')"
        @click="activateTab('contacts', $event)"
      >
        <PantryIcon name="contacts" :size="25" />
      </button>
      <div class="spacer"></div>
      <button
        type="button"
        class="rail-btn rail-hint"
        :class="{
          scanning: scanProgress.running,
          'is-disabled': !canScanAllRanges,
          'show-hint': activeRailHint === 'scan'
        }"
        :aria-disabled="!canScanAllRanges"
        :data-label="scanButtonTitle"
        :aria-label="scanProgress.running ? scanProgressTitle : scanButtonTitle"
        @pointermove="scheduleRailHint('scan')"
        @pointerleave="hideRailHint('scan')"
        @click="refreshAllUsers($event)"
      >
        <span
          class="scan-ring"
          :class="{ visible: scanProgressVisible }"
          :style="{ '--scan-p': scanPercent }"
          aria-hidden="true"
        ></span>
        <PantryIcon name="refresh" :size="21" />
      </button>
      <button
        type="button"
        class="rail-btn rail-hint"
        :class="{ 'show-hint': activeRailHint === 'settings' }"
        data-label="设置"
        aria-label="设置"
        @pointermove="scheduleRailHint('settings')"
        @pointerleave="hideRailHint('settings')"
        @click="openSettings($event)"
      >
        <PantryIcon name="settings" :size="21" />
      </button>
    </nav>

    <aside class="list">
      <div class="search-box">
        <div class="search-field">
          <PantryIcon class="search-mark" name="search" :size="15" />
          <input v-model="searchQuery" class="search" placeholder="搜索" />
          <button v-if="searchQuery" class="clear" title="清空" @click="searchQuery = ''">
            <PantryIcon name="x" :size="13" />
          </button>
        </div>
        <!-- 群发入口已停用（决议 #62）：直接建讨论组即可，群发无意义；保留留痕
        <button class="new-group" title="群发消息" @click="showMassSender = true">
          <PantryIcon name="send-many" :size="16" />
        </button>
        -->
        <button class="new-group" title="发起讨论组" @click="showGroupCreator = true">
          <PantryIcon name="plus" :size="17" />
        </button>
      </div>
      <GroupCreator v-if="showGroupCreator" @close="showGroupCreator = false" />
      <!-- <MassSender v-if="showMassSender" @close="showMassSender = false" /> 群发已停用（决议 #62） -->
      <SearchPanel
        v-if="searchQuery.trim()"
        :query="searchQuery.trim()"
        @navigate="((searchQuery = ''), (tab = 'chat'))"
      />
      <ConvList v-else-if="tab === 'chat'" />
      <PeerList v-else @select="onSelectPeer" @chat="chatWith" />
    </aside>

    <main class="content">
      <ProfileCard
        v-if="tab === 'contacts' && selectedPeer"
        :peer="selectedPeer"
        @chat="chatWith"
      />
      <ChatPane v-else-if="chatStore.activeConv" />
      <div v-else class="empty">
        <PantryBrandLogo variant="color" :size="92" class="empty-logo" />
        <div class="brand-title">茶话间</div>
        <p class="quote">{{ quote.text }}</p>
        <p class="quote-author">{{ quote.author }}</p>
        <p class="hint">在「通讯录」里选个人，开始第一句话</p>
      </div>
    </main>
  </div>

  <!-- 移除聊天后的 10 秒撤回提示（决议 #125）：倒计时结束才真正删除聊天记录 -->
  <div v-if="chatStore.pendingRemoval" class="undo-toast" role="status">
    <span class="undo-text">已删除与「{{ chatStore.pendingRemoval.name }}」的聊天记录</span>
    <button type="button" class="undo-btn" @click="chatStore.undoRemoveConversation()">
      撤回 {{ chatStore.pendingRemoval.secondsLeft }}s
    </button>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* 栏① 导航 */
.rail {
  /* 68px 容纳标准 mac 红绿灯（决议 #68）；浅灰底（决议 #70，微信式）让红绿灯落在浅色上自然 */
  width: 68px;
  background: var(--rail-bg);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 38px 0 12px; /* 顶部让出拖拽带与 mac 红绿灯 */
  gap: 8px;
}
.avatar-wrap {
  position: relative;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  outline: none;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%; /* 决议：圆形头像 */
  display: grid;
  place-items: center;
  font-weight: 600;
  font-size: 18px;
}
.self-card {
  position: absolute;
  left: 52px;
  top: -8px;
  z-index: 30;
  width: 286px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bubble-peer);
  color: var(--text-1);
  box-shadow: 0 18px 42px rgba(20, 28, 24, 0.14);
  display: flex;
  flex-direction: column;
  gap: 12px;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transform: translateX(-5px);
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    visibility 0s linear 180ms;
}
.avatar-wrap:hover .self-card {
  opacity: 1;
  visibility: visible;
  transform: translateX(0);
  transition-delay: 420ms, 420ms, 0s;
}
.self-card-head {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.self-card-avatar {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}
.self-card-title {
  min-width: 0;
  flex: 1;
}
.self-card-name {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.self-card-subtitle {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 5px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--primary-weak);
  color: var(--primary);
  font-size: 11px;
  line-height: 1;
}
.self-card-body {
  display: grid;
  gap: 8px;
}
.self-card-row,
.self-card-tile {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-list);
}
.self-card-row {
  display: grid;
  gap: 5px;
}
.self-card-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(86px, 0.9fr);
  gap: 8px;
}
.self-card-tile {
  display: grid;
  gap: 5px;
}
.self-card-label {
  color: var(--text-3);
  font-size: 11px;
  line-height: 1;
}
.self-card-value {
  min-width: 0;
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.rail-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 8px;
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  background: transparent;
  color: var(--text-2); /* 浅灰底上用深灰图标（决议 #70） */
  cursor: pointer;
  display: grid;
  place-items: center;
}
.rail-btn:focus,
.rail-btn:focus-visible {
  outline: none;
}
.rail-hint::after {
  content: attr(data-label);
  position: absolute;
  top: 50%;
  left: calc(100% + 10px);
  z-index: 25;
  min-width: max-content;
  max-width: 160px;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(36, 42, 38, 0.96);
  color: #fff;
  font-size: 12px;
  line-height: 1.2;
  letter-spacing: 0;
  white-space: nowrap;
  box-shadow: 0 8px 18px rgba(18, 24, 20, 0.14);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-50%);
  transition:
    opacity 90ms ease,
    visibility 0s linear 90ms;
}
.rail-hint.show-hint::after {
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}
.rail-btn.active,
.rail-btn:hover {
  background: var(--primary-weak);
  color: var(--primary); /* 选中/悬停茶青高亮，品牌主色点缀 */
}
.rail-btn.is-disabled:not(.scanning) {
  cursor: default;
  opacity: 0.45;
}
.rail-btn.is-disabled:not(.scanning):hover {
  background: transparent;
  color: var(--text-2);
}
.rail-btn.scanning,
.rail-btn.scanning:hover {
  /* 扫描态不再用方块底/图标旋转，进度改由图标外圈环形表达（决议 #162） */
  background: transparent;
  color: var(--primary);
  opacity: 1;
}
.scan-ring {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: conic-gradient(var(--primary) calc(var(--scan-p, 0) * 1%), var(--line) 0);
  -webkit-mask: radial-gradient(closest-side, transparent 72%, #000 76%);
  mask: radial-gradient(closest-side, transparent 72%, #000 76%);
  opacity: 0;
  transition: opacity 180ms ease;
  pointer-events: none;
}
.scan-ring.visible {
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
@media (prefers-reduced-motion: reduce) {
  .rail-hint::after,
  .self-card,
  .scan-ring {
    transition: none;
  }
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
  /* 与聊天头部 .head 等高（84px），两栏顶栏分隔线连成一条（决议 #127）；
     padding-top 32px 让出拖拽带与 mac 红绿灯，与 .head 一致 */
  height: 84px;
  flex: 0 0 84px;
  box-sizing: border-box;
  padding: 32px 12px 0;
  display: flex;
  gap: 6px;
  align-items: center;
  border-bottom: 1px solid var(--line);
}
.search-field {
  flex: 1;
  min-width: 0;
  position: relative;
}
.search-mark {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.search-field .search {
  flex: 1;
}
.new-group {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: var(--line);
  color: var(--text-2);
  cursor: pointer;
  flex-shrink: 0;
  display: grid;
  place-items: center;
}
.new-group:hover {
  background: var(--primary);
  color: #fff;
}
.clear {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  width: 18px;
  height: 18px;
  padding: 0;
  display: grid;
  place-items: center;
}
.search {
  width: 100%;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: var(--line);
  padding: 0 26px 0 28px;
  font-size: 13px;
  outline: none;
}

/* 栏③ 内容 */
.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-chat);
  display: grid;
}
.empty {
  place-self: center;
  text-align: center;
  color: var(--text-3);
}
.empty-logo {
  margin: 0 auto 14px;
}
.brand-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 12px;
}
.quote {
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.7;
  max-width: 360px;
  margin: 0 auto 6px;
}
.quote-author {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 14px;
}
.hint {
  font-size: 12px;
}

/* 移除聊天撤回提示（决议 #125）：底部居中浮条，茶青撤回按钮，尊重 reduced-motion */
.undo-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: calc(100% - 48px);
  padding: 10px 12px 10px 16px;
  border-radius: 10px;
  background: var(--bg-window);
  border: 1px solid var(--line);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.18);
  animation: undo-rise 0.18s ease;
}
.undo-text {
  min-width: 0;
  font-size: 13px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.undo-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: var(--primary-weak);
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.undo-btn:hover {
  background: var(--primary);
  color: #fff;
}
@keyframes undo-rise {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .undo-toast {
    animation: none;
  }
}
</style>
