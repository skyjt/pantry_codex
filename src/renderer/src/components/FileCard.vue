<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { MessageView, TransferView } from '../../../shared/ipc'
import { fmtBytes, useTransfersStore } from '../stores/transfers'
import { usePeersStore } from '../stores/peers'
import FileTypeIcon from './FileTypeIcon.vue'
import PantryIcon from './PantryIcon.vue'

// 文件消息卡片（ui-design §5，决议 #89「左信息 · 右状态」）：
// 左侧文件名 + 大小/进度；右侧二选一——有操作显示按钮、无操作显示状态徽标，
// 状态文字不再单独占左侧一行。

const props = defineProps<{ msg: MessageView }>()
const transfers = useTransfersStore()
const peersStore = usePeersStore()

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
// 群聊文件接收名单（决议 #75）：x/x 计数 + 已接收成员名（备注优先）
const totalCount = computed(() => transferIds.value.length)
const doneCount = computed(() => transferList.value.filter((t) => t.status === 'done').length)
const receivedNames = computed(() =>
  transferList.value.filter((t) => t.status === 'done').map((t) => peersStore.nameOf(t.peerId))
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

// 单发传输中：左侧显示进度条 + 进度文字（x/y · 速率）
const inProgress = computed(() => !multiOut.value && transfer.value?.status === 'accepted')

// meta 行（决议 #89）：单发传输中显示「已传 / 总量 · 速率」，否则显示大小（+ 文件数）
const metaText = computed(() => {
  const t = transfer.value
  if (inProgress.value && t) {
    return `${fmtBytes(t.bytesDone)} / ${fmtBytes(t.totalSize)} · ${fmtBytes(speed.value)}/s`
  }
  const r = ref_.value
  if (!r) return ''
  const base = r.count > 1 ? `${fmtBytes(r.size)} · ${r.count} 个文件` : fmtBytes(r.size)
  // 群发传输中：大小后附整体速率（群聊用「已接收 x/x」计数代替进度条，决议 #75）
  if (multiActive.value && speed.value > 0) return `${base} · ${fmtBytes(speed.value)}/s`
  return base
})

// 右侧状态徽标文字（仅在无操作按钮时显示）
const statusText = computed(() => {
  if (multiOut.value) {
    const total = transferIds.value.length
    const list = transferList.value
    const done = list.filter((t) => t.status === 'done').length
    const failed = list.filter((t) =>
      t.status === 'failed' || t.status === 'declined' || t.status === 'canceled'
    ).length
    if (done === total) return '已全部送达'
    if (failed === total && total > 0) return '传输失败'
    if (failed > 0) return `${failed} 位未完成`
    return `等待 ${total} 位成员接收`
  }
  const t = transfer.value
  if (!t) return ''
  switch (t.status) {
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

// 右侧操作判定（决议 #89）：有操作显示按钮，否则显示状态徽标
const showRecvActions = computed(
  () => !multiOut.value && transfer.value?.status === 'offering' && transfer.value.direction === 'in'
)
const showCancel = computed(
  () =>
    multiActive.value ||
    (!multiOut.value &&
      (transfer.value?.status === 'offering' || transfer.value?.status === 'accepted'))
)
// 单发等待对方接收：取消按钮上方加「等待接收」小字
const waitingOut = computed(
  () => !multiOut.value && transfer.value?.status === 'offering' && transfer.value.direction === 'out'
)
const showReveal = computed(
  () => !multiOut.value && transfer.value?.status === 'done' && transfer.value.direction === 'in'
)
const showRetry = computed(
  () => !multiOut.value && transfer.value?.status === 'failed' && transfer.value.direction === 'in'
)
const showBadge = computed(
  () => !showRecvActions.value && !showCancel.value && !showReveal.value && !showRetry.value
)
// 徽标配色：完成绿（带对勾）、取消灰、拒收/失败红
const badgeTone = computed(() => {
  if (multiOut.value) {
    const list = transferList.value
    const done = list.filter((t) => t.status === 'done').length
    if (list.length > 0 && done === list.length) return 'done'
    const failed = list.filter(
      (t) => t.status === 'failed' || t.status === 'declined' || t.status === 'canceled'
    ).length
    return failed > 0 ? 'failed' : 'muted'
  }
  const s = transfer.value?.status
  if (s === 'done') return 'done'
  if (s === 'failed' || s === 'declined') return 'failed'
  return 'muted'
})

onMounted(() => {
  for (const id of transferIds.value) void transfers.ensure(id)
})

function cancelActiveTransfers(): void {
  for (const id of transferIds.value) transfers.cancel(id)
}
</script>

<template>
  <div v-if="ref_" class="card">
    <div class="icon">
      <FileTypeIcon :name="ref_.name" :dir="ref_.dir" :size="36" />
    </div>
    <div class="info">
      <div class="name" :title="ref_.name">{{ ref_.name }}</div>
      <div class="meta">{{ metaText }}</div>
      <div v-if="inProgress" class="bar">
        <div class="fill" :style="{ width: `${percent}%` }"></div>
      </div>
      <div v-if="multiOut" class="recv">
        <span class="recv-count">已接收 {{ doneCount }}/{{ totalCount }}</span>
        <span class="recv-pop" role="tooltip">
          <template v-if="receivedNames.length">{{ receivedNames.join('、') }}</template>
          <template v-else>还没有人接收</template>
        </span>
      </div>
    </div>
    <div class="tail">
      <template v-if="showRecvActions">
        <button class="act primary" @click="transfers.accept(ref_.transferId)">接收</button>
        <button class="act" @click="transfers.accept(ref_.transferId, true)">另存为</button>
        <button class="act danger" @click="transfers.decline(ref_.transferId)">拒绝</button>
      </template>
      <template v-else-if="showCancel">
        <span v-if="waitingOut" class="hint">等待接收</span>
        <button class="act danger" @click="cancelActiveTransfers">取消</button>
      </template>
      <button v-else-if="showReveal" class="act" @click="transfers.reveal(ref_.transferId)">
        打开所在文件夹
      </button>
      <button v-else-if="showRetry" class="act primary" @click="transfers.accept(ref_.transferId)">
        继续
      </button>
      <span v-else-if="showBadge" class="badge" :class="badgeTone">
        <PantryIcon v-if="badgeTone === 'done'" name="check" :size="13" />
        {{ statusText }}
      </span>
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
.recv {
  position: relative;
  display: inline-block;
  margin-top: 6px;
}
.recv-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  border-bottom: 1px dashed currentColor;
  cursor: default;
}
.recv-pop {
  display: none;
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  min-width: 120px;
  max-width: 220px;
  padding: 7px 10px;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-1);
  white-space: normal;
  z-index: 8;
}
.recv:hover .recv-pop {
  display: block;
}
/* 右侧操作 / 状态区（决议 #89）：垂直居中；按钮组等宽，状态徽标靠右 */
.tail {
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
  white-space: nowrap;
}
.act.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.act.danger {
  color: var(--danger);
}
.hint {
  font-size: 10px;
  color: var(--text-3);
  text-align: center;
}
.badge {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--text-3);
}
.badge.done {
  color: var(--online);
}
.badge.failed {
  color: var(--danger);
}
.badge.muted {
  color: var(--text-3);
}
</style>
