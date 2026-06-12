<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { MessageView, TransferView } from '../../../shared/ipc'
import { fmtBytes, useTransfersStore } from '../stores/transfers'
import PantryIcon from './PantryIcon.vue'

// 文件消息卡片（ui-design §5）：等待对方接收 → 传输中（进度+速率+取消）
// → 已完成（打开所在文件夹）→ 已取消 / 已拒收 / 失败

const props = defineProps<{ msg: MessageView }>()
const transfers = useTransfersStore()

const ref_ = computed(() => props.msg.fileRef)
const transferIds = computed(() => {
  if (!ref_.value) return []
  return ref_.value.transferIds && ref_.value.transferIds.length > 0
    ? ref_.value.transferIds
    : [ref_.value.transferId]
})
const transferList = computed(() =>
  transferIds.value.map((id) => transfers.byId[id]).filter((item): item is TransferView => !!item)
)
const transfer = computed(() => transferList.value[0])
const multiOut = computed(
  () => transferIds.value.length > 1 && transferList.value.every((t) => t.direction === 'out')
)
const multiActive = computed(
  () => multiOut.value && transferList.value.some((t) => t.status === 'offering' || t.status === 'accepted')
)
const percent = computed(() => {
  const list = multiOut.value ? transferList.value : transfer.value ? [transfer.value] : []
  const total = list.reduce((sum, t) => sum + t.totalSize, 0)
  const done = list.reduce((sum, t) => sum + t.bytesDone, 0)
  if (total === 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
})
const speed = computed(() =>
  transferIds.value.reduce((sum, id) => sum + (transfers.speed[id] ?? 0), 0)
)
const statusText = computed(() => {
  if (multiOut.value) {
    const total = transferIds.value.length
    const list = transferList.value
    const done = list.filter((t) => t.status === 'done').length
    const failed = list.filter((t) =>
      t.status === 'failed' || t.status === 'declined' || t.status === 'canceled'
    ).length
    const active = list.some((t) => t.status === 'accepted')
    if (done === total) return '已完成'
    if (active) return `${done} / ${total} 位完成 · ${fmtBytes(speed.value)}/s`
    if (failed === total && total > 0) return '传输失败'
    if (failed > 0) return `${done} / ${total} 位完成，${failed} 位未完成`
    return `等待 ${total} 位成员接收`
  }
  const t = transfer.value
  if (!t) return ''
  switch (t.status) {
    case 'offering':
      return t.direction === 'out' ? '等待对方接收' : '等待你接收'
    case 'accepted':
      return `${fmtBytes(t.bytesDone)} / ${fmtBytes(t.totalSize)} · ${fmtBytes(speed.value)}/s`
    case 'done':
      return '已完成'
    case 'declined':
      return t.direction === 'out' ? '对方已拒收' : '已拒收'
    case 'canceled':
      return '已取消'
    default:
      return '传输失败'
  }
})

onMounted(() => {
  for (const id of transferIds.value) void transfers.ensure(id)
})

function cancelActiveTransfers(): void {
  for (const id of transferIds.value) transfers.cancel(id)
}
</script>

<template>
  <div v-if="ref_" class="card" :class="transfer?.status">
    <div class="icon">
      <PantryIcon :name="ref_.dir ? 'folder' : 'file'" :size="28" />
    </div>
    <div class="info">
      <div class="name" :title="ref_.name">{{ ref_.name }}</div>
      <div class="meta">
        {{ fmtBytes(ref_.size) }}<span v-if="ref_.count > 1"> · {{ ref_.count }} 个文件</span>
      </div>
      <div v-if="transfer?.status === 'accepted' || multiOut" class="bar">
        <div class="fill" :style="{ width: `${percent}%` }"></div>
      </div>
      <div class="state" :class="transfer?.status">{{ statusText }}</div>
    </div>
    <div class="actions">
      <template v-if="transfer?.status === 'offering' && transfer.direction === 'in'">
        <button class="act primary" @click="transfers.accept(ref_.transferId)">接收</button>
        <button class="act" @click="transfers.accept(ref_.transferId, true)">另存为</button>
        <button class="act danger" @click="transfers.decline(ref_.transferId)">拒绝</button>
      </template>
      <button
        v-else-if="
          multiActive ||
          transfer?.status === 'offering' ||
          transfer?.status === 'accepted'
        "
        class="act danger"
        @click="cancelActiveTransfers"
      >
        取消
      </button>
      <button
        v-else-if="transfer?.status === 'done' && transfer.direction === 'in'"
        class="act"
        @click="transfers.reveal(ref_.transferId)"
      >
        打开所在文件夹
      </button>
      <button
        v-else-if="transfer?.status === 'failed' && transfer.direction === 'in'"
        class="act primary"
        @click="transfers.accept(ref_.transferId)"
      >
        继续
      </button>
    </div>
  </div>
</template>

<style scoped>
.card {
  width: 260px;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  gap: 10px;
}
.icon {
  color: var(--primary);
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
}
.info {
  flex: 1;
  min-width: 0;
}
.name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
}
.bar {
  height: 4px;
  background: var(--line);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.2s;
}
.state {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 4px;
}
.state.done {
  color: var(--online);
}
.state.failed,
.state.declined {
  color: var(--danger);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  flex-shrink: 0;
}
.act {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 4px;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
  color: var(--text-2);
}
.act.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.act.danger {
  color: var(--danger);
}
</style>
