<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ConversationView } from '../../../shared/ipc'
import { usePeersStore } from '../stores/peers'
import { useChatStore } from '../stores/chat'
import { useGroupsStore } from '../stores/groups'
import { listTime } from '../utils/time'
import { splitEmojiText } from '../utils/compat-emoji'
import AvatarMark from './AvatarMark.vue'
import CompatEmoji from './CompatEmoji.vue'
import PantryIcon from './PantryIcon.vue'

const peersStore = usePeersStore()
const chatStore = useChatStore()
const groupsStore = useGroupsStore()
const menu = ref<{ x: number; y: number; conv: ConversationView } | null>(null)

const nickOf = computed(() => peersStore.nameOf) // 备注优先（F-DISC-9）

function convName(conv: ConversationView): string {
  return conv.type === 'group' ? groupsStore.nameOf(conv.peerId) : nickOf.value(conv.peerId)
}

function openMenu(event: MouseEvent, conv: ConversationView): void {
  menu.value = { x: event.clientX, y: event.clientY, conv }
}

async function togglePin(): Promise<void> {
  const conv = menu.value?.conv
  menu.value = null
  if (conv) await chatStore.pinConversation(conv.id, !conv.pinned)
}

async function toggleMute(): Promise<void> {
  const conv = menu.value?.conv
  menu.value = null
  if (conv) await chatStore.muteConversation(conv.id, !conv.muted)
}

const confirmConv = ref<ConversationView | null>(null)

const confirmName = computed(() => (confirmConv.value ? convName(confirmConv.value) : ''))

// 移除聊天（决议 #125）：右键菜单先弹二次确认，确认后才进入 10 秒撤回窗口
function askRemoveConv(): void {
  const conv = menu.value?.conv
  menu.value = null
  if (conv) confirmConv.value = conv
}

function confirmRemove(): void {
  const conv = confirmConv.value
  confirmConv.value = null
  if (conv) chatStore.requestRemoveConversation(conv.id, convName(conv))
}
</script>

<template>
  <div class="pane" @click="menu = null">
    <div v-if="chatStore.visibleConvs.length === 0" class="placeholder">
      还没有会话<br />去「通讯录」找个人开聊
    </div>
    <ul v-else class="conv-list">
      <li
        v-for="conv in chatStore.visibleConvs"
        :key="conv.id"
        class="conv"
        :class="{ active: conv.id === chatStore.activeConvId }"
        @click="chatStore.openConv(conv.id)"
        @contextmenu.prevent.stop="openMenu($event, conv)"
      >
        <span v-if="conv.type === 'group'" class="conv-avatar grp">
          <PantryIcon v-if="conv.type === 'group'" name="users" :size="18" />
        </span>
        <AvatarMark
          v-else
          class="conv-avatar"
          :avatar="peersStore.byId(conv.peerId)?.avatar ?? -1"
          :name="nickOf(conv.peerId)"
          :presence="(peersStore.byId(conv.peerId)?.online ?? false) ? 'online' : 'offline'"
        />
        <span class="conv-main">
          <span class="row1">
            <span class="conv-name">
              <em v-if="conv.pinned" class="flag">置顶</em>
              <em v-if="conv.muted" class="flag muted">静音</em>
              {{ convName(conv) }}
            </span>
            <span class="conv-time">{{ listTime(conv.lastTs) }}</span>
          </span>
          <span class="row2">
            <span v-if="conv.mentioned" class="mention">[有人@我]</span>
            <span class="conv-preview">
              <template v-for="(part, index) in splitEmojiText(conv.preview)" :key="index">
                <CompatEmoji v-if="part.emoji" :emoji="part.text" />
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
            <span v-if="conv.unread > 0" class="badge" :class="{ muted: conv.muted }">{{
              conv.unread > 99 ? '99+' : conv.unread
            }}</span>
          </span>
        </span>
      </li>
    </ul>
    <div
      v-if="menu"
      class="conv-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button @click="togglePin">{{ menu.conv.pinned ? '取消置顶' : '置顶' }}</button>
      <button @click="toggleMute">{{ menu.conv.muted ? '取消免打扰' : '免打扰' }}</button>
      <button class="danger" @click="askRemoveConv">移除会话</button>
    </div>

    <!-- 移除聊天二次确认（决议 #125）：确认后删除聊天记录，仍有 10 秒撤回窗口 -->
    <div v-if="confirmConv" class="confirm-mask" @click.self="confirmConv = null">
      <div class="confirm-card" role="dialog" aria-modal="true" aria-label="移除聊天">
        <h3>移除聊天</h3>
        <p>移除后，与「{{ confirmName }}」的聊天记录将被删除。删除后 10 秒内可撤回。</p>
        <div class="confirm-actions">
          <button class="cancel" @click="confirmConv = null">取消</button>
          <button class="danger-btn" @click="confirmRemove">移除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
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
/* 选中当前会话：实心茶青 + 白字（决议 #71，微信式），一眼看清在哪个会话 */
.conv.active,
.conv.active:hover {
  background: var(--primary);
}
.conv.active .conv-name {
  color: #fff;
}
.conv.active .conv-time,
.conv.active .conv-preview {
  color: rgba(255, 255, 255, 0.82);
}
.conv.active .mention {
  color: #fff;
}
.conv.active .flag {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.7);
}
.conv.active .flag.muted {
  color: rgba(255, 255, 255, 0.82);
  border-color: rgba(255, 255, 255, 0.55);
}
.conv.active .badge {
  background: #fff;
  color: var(--primary);
}
.conv.active .badge.muted {
  color: var(--text-2);
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
.conv-avatar.grp {
  background: #6b8e9e; /* 群会话用区分色 */
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
.flag {
  font-style: normal;
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 3px;
  font-size: 10px;
  padding: 0 3px;
  margin-right: 3px;
}
.flag.muted {
  color: var(--text-3);
  border-color: var(--text-3);
}
.conv-time {
  font-size: 11px;
  color: var(--text-3);
  flex-shrink: 0;
}
.conv-preview {
  flex: 1;
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mention {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--badge);
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
.badge.muted {
  background: var(--offline);
  color: #fff;
}
.conv-menu {
  position: fixed;
  min-width: 110px;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 20;
}
.conv-menu button {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-1);
  text-align: left;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.conv-menu button:hover {
  background: var(--line);
}
.conv-menu button.danger {
  color: var(--danger);
}

/* 移除聊天二次确认弹窗（决议 #125）：沿用设计语言——8px 圆角、茶青取消 hover、危险红主按钮 */
.confirm-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  place-items: center;
  z-index: 40;
}
.confirm-card {
  width: 320px;
  background: var(--bg-window);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  padding: 20px 20px 16px;
}
.confirm-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}
.confirm-card p {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
  margin-bottom: 18px;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.confirm-actions button {
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.confirm-actions .cancel {
  border: 1px solid var(--line);
  background: var(--bg-window);
  color: var(--text-2);
}
.confirm-actions .cancel:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.confirm-actions .danger-btn {
  border: none;
  background: var(--danger);
  color: #fff;
}
.confirm-actions .danger-btn:hover {
  filter: brightness(0.96);
}
</style>
