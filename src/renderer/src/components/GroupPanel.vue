<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GroupView } from '../../../shared/ipc'
import { usePeersStore } from '../stores/peers'
import PantryIcon from './PantryIcon.vue'

// 群成员面板（ui-design §5）：成员列表 / 移除 / 添加 / 改名 / 退出。
// 改名/增删人按决议 #27 走管理密码或创建 IP 校验；退出始终允许本人操作。

const props = defineProps<{ group: GroupView; selfId: string }>()
const emit = defineEmits<{ close: [] }>()

const peersStore = usePeersStore()
const renaming = ref(false)
const newName = ref('')
const adding = ref(false)
const adminPassword = ref('')

const addable = computed(() =>
  peersStore.peers.filter((p) => !props.group.members.includes(p.nodeId))
)
const canShowAdmin = computed(
  () => props.group.amMember && (props.group.canManage || props.group.hasAdminPassword)
)
const adminTip = computed(() => {
  if (!props.group.amMember) return ''
  if (props.group.hasAdminPassword) {
    return props.group.adminHint
      ? `群管理需要管理密码；提示：${props.group.adminHint}`
      : '群管理需要管理密码'
  }
  if (props.group.canManage) return '当前 IP 可管理此群'
  return `仅创建 IP ${props.group.creatorIp || '未知'} 可管理此群`
})

function nameOf(id: string): string {
  if (id === props.selfId) return '我'
  return peersStore.nameOf(id)
}

async function rename(): Promise<void> {
  const name = newName.value.trim()
  if (name) await updateAdmin({ name })
  renaming.value = false
}

async function removeMember(id: string): Promise<void> {
  await updateAdmin({ remove: [id] })
}

async function addMember(id: string): Promise<void> {
  await updateAdmin({ add: [id] })
}

async function leave(): Promise<void> {
  await window.pantry.leaveGroup(props.group.groupId)
  emit('close')
}

async function updateAdmin(patch: { name?: string; add?: string[]; remove?: string[] }): Promise<boolean> {
  if (!props.group.canManage && !props.group.hasAdminPassword) return false
  const payload = { ...patch }
  if (props.group.hasAdminPassword) {
    const promptText = props.group.adminHint
      ? `请输入群管理密码\n提示：${props.group.adminHint}`
      : '请输入群管理密码'
    const password = adminPassword.value || window.prompt(promptText)?.trim() || ''
    if (!password) return false
    adminPassword.value = password
    Object.assign(payload, { adminPassword: password })
  }
  const updated = await window.pantry.updateGroup(props.group.groupId, payload)
  if (!updated) {
    if (props.group.hasAdminPassword) adminPassword.value = ''
    window.alert('群管理失败：密码不正确，或当前 IP 没有管理权限')
    return false
  }
  return true
}
</script>

<template>
  <aside class="panel">
    <div class="head">
      <template v-if="renaming">
        <input v-model="newName" class="rename" maxlength="32" @keydown.enter="rename" />
        <button class="mini" title="保存" @click="rename">
          <PantryIcon name="check" :size="14" />
        </button>
      </template>
      <template v-else>
        <span class="title">{{ group.name }}</span>
        <button
          v-if="canShowAdmin"
          class="mini"
          title="改名"
          @click="((renaming = true), (newName = group.name))"
        >
          <PantryIcon name="edit" :size="14" />
        </button>
      </template>
      <span class="spacer"></span>
      <button class="mini" title="关闭" @click="emit('close')">
        <PantryIcon name="x" :size="14" />
      </button>
    </div>

    <div class="count">成员 {{ group.members.length }} / 50</div>
    <div v-if="adminTip" class="admin-tip">{{ adminTip }}</div>
    <ul class="members">
      <li v-for="id in group.members" :key="id">
        <span class="dot" :class="peersStore.byId(id)?.online || id === selfId ? 'on' : 'off'"></span>
        <span class="nm">{{ nameOf(id) }}</span>
        <button
          v-if="canShowAdmin && id !== selfId"
          class="mini danger"
          title="移出"
          @click="removeMember(id)"
        >
          <PantryIcon name="x" :size="13" />
        </button>
      </li>
    </ul>

    <template v-if="group.amMember">
      <button v-if="canShowAdmin" class="add" @click="adding = !adding">
        <PantryIcon name="plus" :size="14" />添加成员
      </button>
      <ul v-if="adding" class="members addlist">
        <li v-for="p in addable" :key="p.nodeId" class="addable" @click="addMember(p.nodeId)">
          <span class="dot" :class="p.online ? 'on' : 'off'"></span>
          <span class="nm">{{ p.remark || p.nick }}</span>
          <PantryIcon class="plus" name="plus" :size="13" />
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
  color: var(--text-3);
  width: 24px;
  height: 24px;
  padding: 0;
  display: grid;
  place-items: center;
}
.mini.danger:hover {
  color: var(--danger);
}
.count {
  font-size: 11px;
  color: var(--text-3);
}
.admin-tip {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-list);
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
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
