<script setup lang="ts">
// 大图查看器：纯渲染层缩放/旋转/平移，图片源仍走 pantry-img://，另存为走既有 IPC。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PantryIcon from './PantryIcon.vue'

const props = defineProps<{ src: string; transferId: string }>()
const emit = defineEmits<{ close: [] }>()

const MIN_ZOOM = 0.08
const MAX_ZOOM = 6
const ZOOM_STEP = 1.2
const FIT_PADDING_X = 72
const FIT_PADDING_Y = 148
const PAN_STEP = 48

type Point = { x: number; y: number }
type DragStart = Point & { offsetX: number; offsetY: number }

const zoom = ref(1)
const rotation = ref(0)
const offset = ref<Point>({ x: 0, y: 0 })
const natural = ref({ width: 0, height: 0 })
const loading = ref(true)
const broken = ref(false)
const saving = ref(false)
const isDragging = ref(false)
const viewMode = ref<'fit' | 'free'>('fit')

let dragStart: DragStart | null = null

const canUseImage = computed(() => !loading.value && !broken.value)
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const imageTransform = computed(
  () =>
    `translate3d(${offset.value.x}px, ${offset.value.y}px, 0) rotate(${rotation.value}deg) scale(${zoom.value})`
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isQuarterTurn(): boolean {
  return Math.abs(rotation.value % 180) === 90
}

function fitScale(): number {
  if (!natural.value.width || !natural.value.height) return 1
  const imageWidth = isQuarterTurn() ? natural.value.height : natural.value.width
  const imageHeight = isQuarterTurn() ? natural.value.width : natural.value.height
  const maxWidth = Math.max(240, window.innerWidth - FIT_PADDING_X)
  const maxHeight = Math.max(180, window.innerHeight - FIT_PADDING_Y)
  return clamp(Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1), MIN_ZOOM, MAX_ZOOM)
}

function centerImage(): void {
  offset.value = { x: 0, y: 0 }
}

function applyFit(): void {
  zoom.value = fitScale()
  centerImage()
  viewMode.value = 'fit'
}

function applyActualSize(): void {
  zoom.value = 1
  centerImage()
  viewMode.value = 'free'
}

function setZoom(nextZoom: number): void {
  zoom.value = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  viewMode.value = 'free'
}

function zoomIn(): void {
  setZoom(zoom.value * ZOOM_STEP)
}

function zoomOut(): void {
  setZoom(zoom.value / ZOOM_STEP)
}

function toggleActualSize(): void {
  if (viewMode.value === 'fit' || Math.abs(zoom.value - fitScale()) < 0.01) {
    applyActualSize()
  } else {
    applyFit()
  }
}

function rotateImage(delta: number): void {
  rotation.value = (rotation.value + delta + 360) % 360
  if (viewMode.value === 'fit') applyFit()
}

async function saveAs(): Promise<void> {
  if (saving.value || broken.value || loading.value) return
  saving.value = true
  try {
    await window.pantry.saveImageAs(props.transferId)
  } finally {
    saving.value = false
  }
}

function onImageLoad(event: Event): void {
  const image = event.currentTarget as HTMLImageElement
  natural.value = {
    width: image.naturalWidth || 1,
    height: image.naturalHeight || 1
  }
  loading.value = false
  broken.value = false
  void nextTick(applyFit)
}

function onImageError(): void {
  loading.value = false
  broken.value = true
}

function onWheel(event: WheelEvent): void {
  if (!canUseImage.value) return
  if (event.deltaY < 0) zoomIn()
  else zoomOut()
}

function onPointerDown(event: PointerEvent): void {
  if (!canUseImage.value || event.button !== 0) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  isDragging.value = true
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    offsetX: offset.value.x,
    offsetY: offset.value.y
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!isDragging.value || !dragStart) return
  const dx = event.clientX - dragStart.x
  const dy = event.clientY - dragStart.y
  offset.value = {
    x: dragStart.offsetX + dx,
    y: dragStart.offsetY + dy
  }
  viewMode.value = 'free'
}

function finishDrag(event: PointerEvent): void {
  if (!isDragging.value) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  isDragging.value = false
  dragStart = null
}

function panBy(dx: number, dy: number): void {
  if (!canUseImage.value) return
  offset.value = { x: offset.value.x + dx, y: offset.value.y + dy }
  viewMode.value = 'free'
}

function onKey(event: KeyboardEvent): void {
  const key = event.key
  const saveShortcut = (event.metaKey || event.ctrlKey) && key.toLowerCase() === 's'
  if (key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (!canUseImage.value && !saveShortcut) return
  if (key === '+' || key === '=') {
    event.preventDefault()
    zoomIn()
  } else if (key === '-' || key === '_') {
    event.preventDefault()
    zoomOut()
  } else if (key === '0') {
    event.preventDefault()
    applyActualSize()
  } else if (key.toLowerCase() === 'f') {
    event.preventDefault()
    applyFit()
  } else if (key.toLowerCase() === 'r') {
    event.preventDefault()
    rotateImage(event.shiftKey ? -90 : 90)
  } else if (saveShortcut) {
    event.preventDefault()
    void saveAs()
  } else if (key === 'ArrowLeft') {
    event.preventDefault()
    panBy(PAN_STEP, 0)
  } else if (key === 'ArrowRight') {
    event.preventDefault()
    panBy(-PAN_STEP, 0)
  } else if (key === 'ArrowUp') {
    event.preventDefault()
    panBy(0, PAN_STEP)
  } else if (key === 'ArrowDown') {
    event.preventDefault()
    panBy(0, -PAN_STEP)
  }
}

function onResize(): void {
  if (viewMode.value === 'fit' && canUseImage.value) applyFit()
}

function resetState(): void {
  zoom.value = 1
  rotation.value = 0
  offset.value = { x: 0, y: 0 }
  natural.value = { width: 0, height: 0 }
  loading.value = true
  broken.value = false
  saving.value = false
  isDragging.value = false
  viewMode.value = 'fit'
  dragStart = null
}

watch(() => props.src, resetState)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="viewer" role="dialog" aria-modal="true" aria-label="图片查看器">
    <header class="viewer-top" @click.stop>
      <div class="viewer-title">
        <span class="viewer-name">图片查看</span>
        <span class="viewer-status">{{ broken ? '不可用' : loading ? '加载中' : zoomLabel }}</span>
      </div>
      <div class="viewer-tools" role="toolbar" aria-label="图片查看工具">
        <button class="tool" type="button" title="缩小" :disabled="!canUseImage" @click="zoomOut">
          <PantryIcon name="zoom-out" :size="17" />
        </button>
        <button class="tool" type="button" title="放大" :disabled="!canUseImage" @click="zoomIn">
          <PantryIcon name="zoom-in" :size="17" />
        </button>
        <button
          class="tool"
          :class="{ active: viewMode === 'fit' }"
          type="button"
          title="适应窗口"
          :disabled="!canUseImage"
          :aria-pressed="viewMode === 'fit'"
          @click="applyFit"
        >
          <PantryIcon name="fit-screen" :size="17" />
        </button>
        <button class="tool" type="button" title="原始大小" :disabled="!canUseImage" @click="applyActualSize">
          <PantryIcon name="actual-size" :size="17" />
        </button>
        <span class="tool-divider" aria-hidden="true"></span>
        <button class="tool" type="button" title="向左旋转" :disabled="!canUseImage" @click="rotateImage(-90)">
          <PantryIcon name="rotate-left" :size="17" />
        </button>
        <button class="tool" type="button" title="向右旋转" :disabled="!canUseImage" @click="rotateImage(90)">
          <PantryIcon name="rotate-right" :size="17" />
        </button>
        <span class="tool-divider" aria-hidden="true"></span>
        <button class="tool" type="button" title="另存为" :disabled="saving || !canUseImage" @click="saveAs">
          <PantryIcon :name="saving ? 'loader' : 'save'" :size="17" />
        </button>
        <button class="tool close" type="button" title="关闭" @click="emit('close')">
          <PantryIcon name="x" :size="17" />
        </button>
      </div>
    </header>

    <main
      class="viewer-stage"
      :class="{ grabbing: isDragging }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finishDrag"
      @pointercancel="finishDrag"
      @dblclick.stop="toggleActualSize"
    >
      <div v-if="loading" class="viewer-state">图片加载中…</div>
      <div v-else-if="broken" class="viewer-state error">图片不可用</div>
      <img
        :src="src"
        class="full"
        :class="{ pending: loading || broken }"
        :style="{ transform: imageTransform }"
        alt="[图片]"
        draggable="false"
        @load="onImageLoad"
        @error="onImageError"
      />
    </main>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 44;
  color: #f5f7f6;
  background: rgba(10, 12, 11, 0.88);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.viewer-top {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 96px));
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 6px 8px 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(28, 32, 30, 0.86);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px);
  z-index: 45;
}
.viewer-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.viewer-name {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
}
.viewer-status {
  min-width: 52px;
  color: rgba(245, 247, 246, 0.68);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.viewer-tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.tool {
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(245, 247, 246, 0.86);
  background: transparent;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;
}
.tool:hover:not(:disabled),
.tool.active {
  color: #ffffff;
  border-color: rgba(91, 191, 145, 0.36);
  background: rgba(91, 191, 145, 0.2);
}
.tool:active:not(:disabled) {
  transform: translateY(1px);
}
.tool:disabled {
  color: rgba(245, 247, 246, 0.28);
  cursor: default;
}
.tool.close:hover {
  border-color: rgba(255, 107, 114, 0.42);
  background: rgba(255, 107, 114, 0.22);
}
.tool-divider {
  width: 1px;
  height: 20px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.14);
}
.viewer-stage {
  flex: 1;
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 74px 36px 36px;
  cursor: default;
  touch-action: none;
}
.viewer-stage.grabbing,
.viewer-stage.grabbing .full {
  cursor: grabbing;
}
.full {
  position: relative;
  max-width: none;
  max-height: none;
  user-select: none;
  -webkit-user-drag: none;
  transform-origin: center center;
  cursor: grab;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 22px 66px rgba(0, 0, 0, 0.38);
  will-change: transform;
  transition: transform 0.14s cubic-bezier(0.2, 0, 0.2, 1);
}
.full.pending {
  opacity: 0;
  pointer-events: none;
}
.viewer-state {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  min-width: 132px;
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(28, 32, 30, 0.82);
  color: rgba(245, 247, 246, 0.76);
  font-size: 13px;
  text-align: center;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
}
.viewer-state.error {
  color: #ffb1b5;
  border-color: rgba(255, 107, 114, 0.26);
  background: rgba(54, 24, 27, 0.82);
}

@supports not (backdrop-filter: blur(18px)) {
  .viewer-top {
    background: #1c201e;
  }
}

@media (max-width: 720px) {
  .viewer-top {
    top: 10px;
    width: calc(100vw - 20px);
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .viewer-tools {
    width: 100%;
    justify-content: space-between;
  }
  .viewer-stage {
    padding: 104px 14px 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool,
  .full {
    transition: none;
  }
}
</style>
