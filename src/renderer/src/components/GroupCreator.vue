<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePeersStore } from '../stores/peers'
import { useChatStore } from '../stores/chat'

// 发起讨论组（ui-design §7.1）：组名 + 联系人多选；创建后直接进入群会话

const props = defineProps<{ preselect?: string[] }>()
const emit = defineEmits<{ close: [] }>()

const peersStore = usePeersStore()
const chatStore = useChatStore()
const name = ref('')
const adminPassword = ref('')
const picked = ref(new Set<string>(props.preselect ?? []))

const canCreate = computed(() => picked.value.size >= 1)

function toggle(nodeId: string): void {
  const next = new Set(picked.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  picked.value = next
}

async function create(): Promise<void> {
  if (!canCreate.value) return
  const memberIds = [...picked.value]
  const fallback = memberIds
    .slice(0, 3)
    .map((id) => peersStore.nameOf(id))
    .join('、')
  const group = await window.pantry.createGroup(
    name.value.trim() || `${fallback} 的讨论组`,
    memberIds,
    adminPassword.value.trim()
  )
  if (group) {
    await chatStore.openConv(`group:${group.groupId}`)
    emit('close')
  }
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <h3>发起讨论组</h3>
      <input v-model="name" class="name" maxlength="32" placeholder="组名（留空自动生成）" />
      <input
        v-model="adminPassword"
        class="name"
        maxlength="64"
        type="password"
        placeholder="管理密码（选填；留空仅创建 IP 可管理）"
      />
      <div class="pick-list">
        <label v-for="p in peersStore.peers" :key="p.nodeId" class="pick">
          <input type="checkbox" :checked="picked.has(p.nodeId)" @change="toggle(p.nodeId)" />
          <span class="dot" :class="p.online ? 'on' : 'off'"></span>
          <span class="nm">{{ p.remark || p.nick }}</span>
          <em v-if="!p.online" class="off-tag">离线</em>
        </label>
        <p v-if="peersStore.peers.length === 0" class="empty">还没有发现任何节点</p>
      </div>
      <div class="foot">
        <span class="count">已选 {{ picked.size }} 人（+你）</span>
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" :disabled="!canCreate" @click="create">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  place-items: center;
  z-index: 15;
}
.dialog {
  width: 360px;
  background: var(--bg-window);
  border-radius: 8px;
  padding: 18px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
}
h3 {
  font-size: 15px;
  margin-bottom: 12px;
}
.name {
  width: 100%;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 13px;
  outline: none;
  margin-bottom: 10px;
  user-select: text;
}
.name:focus {
  border-color: var(--primary);
}
.pick-list {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 4px;
}
.pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
}
.pick:hover {
  background: var(--line);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
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
.off-tag {
  font-style: normal;
  font-size: 11px;
  color: var(--text-3);
}
.empty {
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
  padding: 16px 0;
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.count {
  flex: 1;
  font-size: 12px;
  color: var(--text-3);
}
.primary {
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  padding: 6px 18px;
  border-radius: 4px;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.4;
}
.ghost {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 4px;
  font-size: 13px;
  padding: 6px 14px;
  cursor: pointer;
  color: var(--text-2);
}
</style>
