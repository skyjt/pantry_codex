<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { PeerView } from '../../../shared/ipc'
import PantryIcon from './PantryIcon.vue'
import { avatarStyle, avatarText } from '../utils/avatar'
import { listTime } from '../utils/time'

// 联系人资料页（ui-design §4 / 决议 #40）：单击联系人展示，双击联系人由 PeerList 直达单聊。

const props = defineProps<{ peer: PeerView }>()
const emit = defineEmits<{ chat: [nodeId: string] }>()

const remark = ref(props.peer.remark)
const lastSavedRemark = ref(props.peer.remark)
const saved = ref(false)
const saving = ref(false)
const error = ref('')
const editing = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | null = null

const displayName = computed(() => props.peer.remark || props.peer.nick)
const remarkChanged = computed(() => remark.value.trim() !== lastSavedRemark.value)

watch(
  () => props.peer.nodeId,
  () => {
    remark.value = props.peer.remark
    lastSavedRemark.value = props.peer.remark
    saved.value = false
    saving.value = false
    error.value = ''
    editing.value = false
    clearSavedTimer()
  }
)

watch(
  () => props.peer.remark,
  (next) => {
    lastSavedRemark.value = next
    if (!editing.value) remark.value = next
  }
)

onUnmounted(() => {
  clearSavedTimer()
})

function clearSavedTimer(): void {
  if (savedTimer) {
    clearTimeout(savedTimer)
    savedTimer = null
  }
}

function onRemarkInput(): void {
  editing.value = true
  saved.value = false
  error.value = ''
}

async function saveRemark(): Promise<void> {
  if (saving.value || !remarkChanged.value) return
  saving.value = true
  saved.value = false
  error.value = ''
  clearSavedTimer()
  try {
    const next = remark.value.trim()
    await window.pantry.setPeerRemark(props.peer.nodeId, next)
    remark.value = next
    lastSavedRemark.value = next
    editing.value = false
    saved.value = true
    savedTimer = setTimeout(() => {
      saved.value = false
      savedTimer = null
    }, 1500)
  } catch {
    error.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

function orgPath(p: PeerView): string {
  return [p.company, p.dept, p.team].filter(Boolean).join(' / ') || '未分组'
}

function platformLabel(platform: PeerView['platform']): string {
  if (platform === 'win') return 'Windows'
  if (platform === 'mac') return 'macOS'
  return 'Linux'
}

function lastSeenLabel(peer: PeerView): string {
  if (peer.online) return '当前在线'
  return listTime(peer.lastSeen) || '离线'
}

function profileAvatarStyle(peer: PeerView): { backgroundColor: string; color: string } {
  return peer.online
    ? avatarStyle(peer.avatar, displayName.value)
    : { backgroundColor: 'var(--offline)', color: '#fff' }
}
</script>

<template>
  <div class="profile-page">
    <article class="profile-sheet">
      <header class="profile-hero">
        <span class="avatar" :class="{ off: !peer.online }" :style="profileAvatarStyle(peer)">
          {{ avatarText(peer.avatar, displayName) }}
        </span>
        <div class="identity">
          <div class="identity-row">
            <h2>{{ displayName }}</h2>
            <span class="status-pill" :class="{ on: peer.online }">
              <span class="status-dot"></span>
              {{ peer.online ? '在线' : '离线' }}
            </span>
          </div>
          <p v-if="peer.remark" class="raw-nick">昵称：{{ peer.nick }}</p>
          <p class="org">{{ orgPath(peer) }}</p>
        </div>
      </header>

      <section class="profile-section">
        <div class="section-head">
          <span>备注</span>
          <small>仅自己可见</small>
        </div>
        <div class="remark-line">
          <label for="peer-remark">本地备注</label>
          <input
            id="peer-remark"
            v-model="remark"
            maxlength="32"
            placeholder="仅自己可见，重名时好认"
            @input="onRemarkInput"
            @keydown.enter.prevent="saveRemark"
          />
        </div>
        <p class="helper">保存后，会话列表、通讯录和搜索都会优先显示备注。</p>
      </section>

      <section class="profile-section">
        <div class="section-head">
          <span>详细信息</span>
        </div>
        <div class="info-list">
          <div class="info-row">
            <span>IP</span>
            <strong>{{ peer.ip }}</strong>
          </div>
          <div class="info-row">
            <span>主机</span>
            <strong>{{ peer.host }}</strong>
          </div>
          <div class="info-row">
            <span>平台</span>
            <strong>{{ platformLabel(peer.platform) }}</strong>
          </div>
          <div class="info-row">
            <span>最近</span>
            <strong>{{ lastSeenLabel(peer) }}</strong>
          </div>
        </div>
      </section>

      <footer class="profile-actions">
        <span class="save-state" :class="{ error: error }">{{ error || (saved ? '已保存' : '') }}</span>
        <button class="ghost" :disabled="saving || !remarkChanged" @click="saveRemark">
          <PantryIcon name="check" :size="14" />
          {{ saving ? '保存中' : '保存备注' }}
        </button>
        <button class="primary" @click="emit('chat', peer.nodeId)">
          <PantryIcon name="chat" :size="15" />
          发消息
        </button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.profile-page {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-window);
  display: flex;
  justify-content: center;
}
.profile-sheet {
  width: min(560px, calc(100% - 72px));
  padding: 56px 0 44px;
}
.profile-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--line);
}
.avatar {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.34);
}
.avatar.off {
  background: var(--offline);
}
.identity {
  min-width: 0;
  flex: 1;
}
.identity-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg-list);
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
.status-pill.on {
  color: var(--online);
  background: rgba(43, 162, 69, 0.08);
  border-color: rgba(43, 162, 69, 0.18);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--offline);
}
.status-pill.on .status-dot {
  background: var(--online);
}
.raw-nick,
.org {
  margin: 6px 0 0;
  color: var(--text-3);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-section {
  padding: 22px 0;
  border-bottom: 1px solid var(--line);
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
}
.section-head small {
  color: var(--text-3);
  font-size: 12px;
  font-weight: 400;
}
.remark-line {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.remark-line label,
.info-row span {
  color: var(--text-3);
  font-size: 13px;
}
.remark-line input {
  width: 100%;
  min-width: 0;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg-window);
  color: var(--text-1);
  padding: 0 10px;
  font-size: 13px;
  outline: none;
  user-select: text;
}
.remark-line input::placeholder {
  color: var(--text-placeholder);
}
.remark-line input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(61, 139, 107, 0.1);
}
.helper {
  margin: 9px 0 0 84px;
  color: var(--text-3);
  font-size: 12px;
}
.info-list {
  display: grid;
  gap: 12px;
}
.info-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.info-row strong {
  min-width: 0;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-actions {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 18px;
}
.save-state {
  flex: 1;
  min-width: 0;
  color: var(--online);
  font-size: 12px;
}
.save-state.error {
  color: var(--danger);
}
button {
  height: 34px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}
button:disabled {
  cursor: default;
  opacity: 0.48;
}
.ghost {
  border: 1px solid var(--line);
  background: var(--bg-window);
  color: var(--text-2);
  padding: 0 13px;
}
.ghost:not(:disabled):hover {
  border-color: rgba(61, 139, 107, 0.35);
  color: var(--primary);
}
.primary {
  border: none;
  background: var(--primary);
  color: #fff;
  padding: 0 16px;
}
.primary:hover {
  filter: brightness(0.96);
}
@media (max-width: 760px) {
  .profile-sheet {
    width: calc(100% - 32px);
    padding: 32px 0;
  }
  .profile-hero {
    align-items: flex-start;
  }
  .identity-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .remark-line,
  .info-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .helper {
    margin-left: 0;
  }
  .profile-actions {
    flex-wrap: wrap;
  }
  .save-state {
    flex-basis: 100%;
  }
}
</style>
