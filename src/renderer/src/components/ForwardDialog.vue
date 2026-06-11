<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ForwardTarget, MessageView } from '../../../shared/ipc'
import { usePeersStore } from '../stores/peers'
import { useGroupsStore } from '../stores/groups'
import { useChatStore } from '../stores/chat'
import PantryIcon from './PantryIcon.vue'

const props = defineProps<{ msg: MessageView }>()
const emit = defineEmits<{ close: [] }>()

const peersStore = usePeersStore()
const groupsStore = useGroupsStore()
const chatStore = useChatStore()

const picked = ref(new Set<string>())
const sending = ref(false)
const result = ref('')

const allowGroup = computed(() => props.msg.kind === 'text')
const groups = computed(() => Object.values(groupsStore.byId).filter((g) => g.amMember))
const forwardGroups = computed(() => (allowGroup.value ? groups.value : []))
const canSend = computed(() => picked.value.size > 0 && !sending.value)
const summary = computed(() => {
  if (props.msg.kind === 'text') return props.msg.text.slice(0, 50)
  if (props.msg.kind === 'image') return '[图片]'
  if (props.msg.kind === 'sticker') return '[表情]'
  return props.msg.fileRef ? `[文件] ${props.msg.fileRef.name}` : '[文件]'
})

function toggle(key: string): void {
  const next = new Set(picked.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  picked.value = next
  result.value = ''
}

function targets(): ForwardTarget[] {
  return [...picked.value]
    .map((key) => {
      const [type, id] = key.split(':')
      return type === 'group' || type === 'single' ? { type, id } : null
    })
    .filter((item): item is ForwardTarget => item !== null && item.id.length > 0)
}

async function forward(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  const res = await chatStore.forward(props.msg.id, targets())
  sending.value = false
  result.value = `已转发 ${res.ok}/${res.total}`
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <h3>转发</h3>
      <div class="summary">{{ summary }}</div>
      <div class="pick-list">
        <label v-for="p in peersStore.peers" :key="p.nodeId" class="pick">
          <input
            type="checkbox"
            :checked="picked.has(`single:${p.nodeId}`)"
            @change="toggle(`single:${p.nodeId}`)"
          />
          <span class="dot" :class="p.online ? 'on' : 'off'"></span>
          <span class="nm">{{ p.remark || p.nick }}</span>
          <em v-if="!p.online" class="off-tag">离线</em>
        </label>
        <label v-for="g in forwardGroups" :key="g.groupId" class="pick">
          <input
            type="checkbox"
            :checked="picked.has(`group:${g.groupId}`)"
            @change="toggle(`group:${g.groupId}`)"
          />
          <span class="group-dot"><PantryIcon name="users" :size="13" /></span>
          <span class="nm">{{ g.name }}</span>
        </label>
        <p v-if="peersStore.peers.length === 0 && (!allowGroup || groups.length === 0)" class="empty">
          没有可选目标
        </p>
      </div>
      <div class="foot">
        <span class="count">已选 {{ picked.size }} 个目标</span>
        <span class="result">{{ result }}</span>
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" :disabled="!canSend" @click="forward">
          {{ sending ? '转发中' : '转发' }}
        </button>
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
  z-index: 16;
}
.dialog {
  width: 380px;
  background: var(--bg-window);
  border-radius: 8px;
  padding: 18px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
}
h3 {
  font-size: 15px;
  margin-bottom: 10px;
}
.summary {
  max-height: 62px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 10px;
  white-space: pre-wrap;
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
.group-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #6b8e9e;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 11px;
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
.result {
  font-size: 12px;
  color: var(--primary);
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
