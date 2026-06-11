<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GroupView } from '../../../shared/ipc'
import { usePeersStore } from '../stores/peers'

// 群成员面板（ui-design §5）：成员列表 / 移除 / 添加 / 改名 / 退出。
// 任何成员可操作（F-MSG-4：建群者无特权）。

const props = defineProps<{ group: GroupView; selfId: string }>()
const emit = defineEmits<{ close: [] }>()

const peersStore = usePeersStore()
const renaming = ref(false)
const newName = ref('')
const adding = ref(false)

const addable = computed(() =>
  peersStore.peers.filter((p) => !props.group.members.includes(p.nodeId))
)

function nameOf(id: string): string {
  if (id === props.selfId) return '我'
  return peersStore.nameOf(id)
}

async function rename(): Promise<void> {
  const name = newName.value.trim()
  if (name) await window.pantry.updateGroup(props.group.groupId, { name })
  renaming.value = false
}

async function removeMember(id: string): Promise<void> {
  await window.pantry.updateGroup(props.group.groupId, { remove: [id] })
}

async function addMember(id: string): Promise<void> {
  await window.pantry.updateGroup(props.group.groupId, { add: [id] })
}

async function leave(): Promise<void> {
  await window.pantry.leaveGroup(props.group.groupId)
  emit('close')
}
</script>

<template>
  <aside class="panel">
    <div class="head">
      <template v-if="renaming">
        <input v-model="newName" class="rename" maxlength="32" @keydown.enter="rename" />
        <button class="mini" @click="rename">✓</button>
      </template>
      <template v-else>
        <span class="title">{{ group.name }}</span>
        <button
          v-if="group.amMember"
          class="mini"
          title="改名"
          @click="((renaming = true), (newName = group.name))"
        >
          ✏️
        </button>
      </template>
      <span class="spacer"></span>
      <button class="mini" @click="emit('close')">✕</button>
    </div>

    <div class="count">成员 {{ group.members.length }} / 50</div>
    <ul class="members">
      <li v-for="id in group.members" :key="id">
        <span class="dot" :class="peersStore.byId(id)?.online || id === selfId ? 'on' : 'off'"></span>
        <span class="nm">{{ nameOf(id) }}</span>
        <button
          v-if="group.amMember && id !== selfId"
          class="mini danger"
          title="移出"
          @click="removeMember(id)"
        >
          ✕
        </button>
      </li>
    </ul>

    <template v-if="group.amMember">
      <button class="add" @click="adding = !adding">＋ 添加成员</button>
      <ul v-if="adding" class="members addlist">
        <li v-for="p in addable" :key="p.nodeId" class="addable" @click="addMember(p.nodeId)">
          <span class="dot" :class="p.online ? 'on' : 'off'"></span>
          <span class="nm">{{ p.remark || p.nick }}</span>
          <span class="plus">＋</span>
        </li>
        <li v-if="addable.length === 0" class="empty">没有可添加的人了</li>
      </ul>
      <button class="leave" @click="leave">退出讨论组</button>
    </template>
    <p v-else class="left-tip">你已不在该讨论组（历史保留，无法发言）</p>
  </aside>
</template>

<style scoped>
.panel {
  width: 220px;
  border-left: 1px solid var(--line);
  background: var(--bg-window);
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rename {
  flex: 1;
  height: 26px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 13px;
  outline: none;
  user-select: text;
}
.spacer {
  flex: 1;
}
.mini {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-3);
  padding: 2px 4px;
}
.mini.danger:hover {
  color: var(--danger);
}
.count {
  font-size: 11px;
  color: var(--text-3);
}
.members {
  list-style: none;
  overflow-y: auto;
  flex-shrink: 1;
}
.members li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 2px;
  font-size: 13px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.on {
  background: var(--online);
}
.dot.off {
  background: var(--offline);
}
.nm {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.add {
  border: 1px dashed var(--line);
  background: transparent;
  border-radius: 4px;
  font-size: 12px;
  padding: 6px;
  cursor: pointer;
  color: var(--primary);
}
.addlist {
  max-height: 140px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 2px 6px;
}
.addable {
  cursor: pointer;
}
.addable:hover {
  background: var(--line);
}
.plus {
  color: var(--primary);
}
.empty {
  color: var(--text-3);
  font-size: 12px;
  justify-content: center;
}
.leave {
  margin-top: auto;
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 4px;
  font-size: 12px;
  padding: 7px;
  cursor: pointer;
  color: var(--danger);
}
.left-tip {
  font-size: 12px;
  color: var(--text-3);
  margin-top: auto;
}
</style>
