<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { MessageView } from '../../../shared/ipc'
import { fmtBytes, useTransfersStore } from '../stores/transfers'

// 文件消息卡片（ui-design §5）：等待对方接收 → 传输中（进度+速率+取消）
// → ✓ 已完成（打开所在文件夹）→ ✗ 已取消 / 已拒收 / 失败

const props = defineProps<{ msg: MessageView }>()
const transfers = useTransfersStore()

const ref_ = computed(() => props.msg.fileRef)
const transfer = computed(() =>
  ref_.value ? transfers.byId[ref_.value.transferId] : undefined
)
const percent = computed(() => {
  const t = transfer.value
  if (!t || t.totalSize === 0) return 0
  return Math.min(100, Math.round((t.bytesDone / t.totalSize) * 100))
})
const speed = computed(() =>
  ref_.value ? (transfers.speed[ref_.value.transferId] ?? 0) : 0
)
const statusText = computed(() => {
  const t = transfer.value
  if (!t) return ''
  switch (t.status) {
    case 'offering':
      return t.direction === 'out' ? '等待对方接收' : '等待你接收'
    case 'accepted':
      return `${fmtBytes(t.bytesDone)} / ${fmtBytes(t.totalSize)} · ${fmtBytes(speed.value)}/s`
    case 'done':
      return '✓ 已完成'
    case 'declined':
      return t.direction === 'out' ? '对方已拒收' : '已拒收'
    case 'canceled':
      return '已取消'
    default:
      return '传输失败'
  }
})

onMounted(() => {
  if (ref_.value) void transfers.ensure(ref_.value.transferId)
})
</script>

<template>
  <div v-if="ref_" class="card" :class="transfer?.status">
    <div class="icon">{{ ref_.dir ? '📁' : '📄' }}</div>
    <div class="info">
      <div class="name" :title="ref_.name">{{ ref_.name }}</div>
      <div class="meta">
        {{ fmtBytes(ref_.size) }}<span v-if="ref_.count > 1"> · {{ ref_.count }} 个文件</span>
      </div>
      <div v-if="transfer?.status === 'accepted'" class="bar">
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
        v-else-if="transfer?.status === 'offering' || transfer?.status === 'accepted'"
        class="act danger"
        @click="transfers.cancel(ref_.transferId)"
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
  font-size: 28px;
  flex-shrink: 0;
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
