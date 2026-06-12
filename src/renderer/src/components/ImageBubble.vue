<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { MessageView } from '../../../shared/ipc'
import { useTransfersStore } from '../stores/transfers'
import { useStickersStore } from '../stores/stickers'
import ImageViewer from './ImageViewer.vue'
import PantryIcon from './PantryIcon.vue'

// 图片/表情消息气泡（ui-design §5）：图片 ≤280px 可看大图；表情固定 120px。
// 右键「添加到表情」（F-MSG-7）。图源走 pantry-img:// 自定义协议。

const emit = defineEmits<{ forward: [] }>()
const props = defineProps<{ msg: MessageView }>()
const transfers = useTransfersStore()
const stickersStore = useStickersStore()
const viewing = ref(false)
const broken = ref(false)
const menuAt = ref<{ x: number; y: number } | null>(null)
const addTip = ref('')
const addTipKind = ref<'ok' | 'fail'>('ok')
const MENU_WIDTH = 112
const MENU_HEIGHT = 68
const MENU_MARGIN = 8
let addTipTimer: number | undefined

const isSticker = computed(() => props.msg.kind === 'sticker')

function onContextMenu(event: MouseEvent): void {
  event.stopPropagation()
  const maxX = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN)
  const maxY = Math.max(MENU_MARGIN, window.innerHeight - MENU_HEIGHT - MENU_MARGIN)
  menuAt.value = {
    x: Math.max(MENU_MARGIN, Math.min(event.clientX, maxX)),
    y: Math.max(MENU_MARGIN, Math.min(event.clientY, maxY))
  }
}

async function addToStickers(): Promise<void> {
  menuAt.value = null
  const ok = await stickersStore.addFromTransfer(transferId.value)
  addTipKind.value = ok ? 'ok' : 'fail'
  addTip.value = ok ? '已添加到表情' : '添加失败'
  clearAddTipTimer()
  addTipTimer = window.setTimeout(() => {
    addTip.value = ''
    addTipTimer = undefined
  }, 1500)
}

function forwardImage(): void {
  menuAt.value = null
  emit('forward')
}

function clearAddTipTimer(): void {
  if (addTipTimer !== undefined) {
    window.clearTimeout(addTipTimer)
    addTipTimer = undefined
  }
}

const transferId = computed(() => props.msg.fileRef?.transferId ?? '')
const transfer = computed(() => transfers.byId[transferId.value])
const ready = computed(
  () => transfer.value?.status === 'done' || (props.msg.isMine && !!transfer.value?.savedPath)
)
const src = computed(() => `pantry-img://${transferId.value}`)
const failed = computed(
  () =>
    broken.value ||
    transfer.value?.status === 'failed' ||
    transfer.value?.status === 'canceled' ||
    transfer.value?.status === 'declined'
)

onMounted(() => {
  if (transferId.value) void transfers.ensure(transferId.value)
})

onUnmounted(clearAddTipTimer)
</script>

<template>
  <div class="img-bubble" :class="{ mine: props.msg.isMine, peer: !props.msg.isMine }" @mouseleave="menuAt = null">
    <img
      v-if="ready && !failed"
      :src="src"
      class="thumb"
      :class="{ sticker: isSticker }"
      alt="[图片]"
      @click="!isSticker && (viewing = true)"
      @error="broken = true"
      @contextmenu.prevent.stop="onContextMenu"
    />
    <div v-else-if="failed" class="ph fail">{{ isSticker ? '表情' : '图片' }}传输失败</div>
    <div v-else class="ph" :class="{ sticker: isSticker }">
      {{ isSticker ? '表情' : '图片' }}接收中…
    </div>
    <div
      v-if="menuAt"
      class="ctx"
      :style="{ left: `${menuAt.x}px`, top: `${menuAt.y}px` }"
      @click.stop
    >
      <button type="button" @click="forwardImage">转发</button>
      <button type="button" @click="addToStickers">添加到表情</button>
    </div>
    <span
      v-if="addTip"
      class="tip"
      :class="addTipKind"
      role="status"
      aria-live="polite"
    >
      <PantryIcon v-if="addTipKind === 'ok'" name="check" :size="12" class="tip-icon" />
      <span v-else class="tip-mark">!</span>
      <span>{{ addTip }}</span>
    </span>
    <ImageViewer
      v-if="viewing"
      :src="src"
      :transfer-id="transferId"
      @close="viewing = false"
    />
  </div>
</template>

<style scoped>
.img-bubble {
  position: relative;
  display: inline-block;
}
.thumb {
  max-width: 280px;
  max-height: 280px;
  border-radius: 8px;
  cursor: zoom-in;
  display: block;
  border: 1px solid var(--line);
}
.thumb.sticker {
  max-width: 120px;
  max-height: 120px;
  cursor: default;
  border: none;
}
.ph.sticker {
  width: 120px;
  height: 120px;
}
.ctx {
  position: fixed;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 6;
}
.ctx button {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-1);
  text-align: left;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.ctx button:hover {
  background: var(--line);
}
.tip {
  position: absolute;
  top: 50%;
  left: calc(100% + 8px);
  --tip-enter-x: -4px;
  transform: translate(0, -50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 4px 8px 4px 7px;
  border: 1px solid rgba(61, 139, 107, 0.22);
  border-radius: 999px;
  background: var(--bg-window);
  box-shadow: 0 6px 18px rgba(34, 49, 42, 0.14);
  color: var(--primary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  pointer-events: none;
  white-space: nowrap;
  z-index: 5;
}
.img-bubble.mine .tip {
  left: auto;
  right: calc(100% + 8px);
  --tip-enter-x: 4px;
}
.tip.fail {
  border-color: rgba(229, 72, 77, 0.24);
  color: var(--danger);
}
.tip-icon,
.tip-mark {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
}
.tip-mark {
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(229, 72, 77, 0.1);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}
.ph {
  width: 180px;
  height: 120px;
  border-radius: 8px;
  background: var(--line);
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--text-3);
}
.ph.fail {
  color: var(--danger);
}
@media (prefers-reduced-motion: no-preference) {
  .tip {
    animation: tip-pop 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }
}
@keyframes tip-pop {
  from {
    opacity: 0;
    transform: translate(var(--tip-enter-x), -50%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(0, -50%) scale(1);
  }
}
</style>
