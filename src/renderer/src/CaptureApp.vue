<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 截图框选窗（F-CAP-1）：屏幕图像做背景 → 拖拽框选 → 发送/复制/取消。
// Esc 取消，Enter=发送。坐标按 scaleFactor 还原到物理像素裁剪。

const dataUrl = ref('')
const scale = ref(1)
const dragging = ref(false)
const startX = ref(0)
const startY = ref(0)
const rect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
type Tool = 'select' | 'rect' | 'arrow' | 'text' | 'mosaic'
interface Annotation {
  type: Exclude<Tool, 'select'>
  x: number
  y: number
  w: number
  h: number
  text?: string
}
const tool = ref<Tool>('select')
const annotations = ref<Annotation[]>([])
const drawingAnnotation = ref<number | null>(null)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = window.pantry.onCaptureInit((url, factor) => {
    dataUrl.value = url
    scale.value = factor
  })
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', onKey)
})

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') void window.pantry.captureDone(new ArrayBuffer(0), false)
  if (event.key === 'Enter' && rect.value) void confirm(true)
}

function onMouseDown(event: MouseEvent): void {
  if (rect.value && tool.value !== 'select' && inSelection(event.clientX, event.clientY)) {
    startAnnotation(event)
    return
  }
  dragging.value = true
  startX.value = event.clientX
  startY.value = event.clientY
  rect.value = { x: event.clientX, y: event.clientY, w: 0, h: 0 }
  annotations.value = []
}

function onMouseMove(event: MouseEvent): void {
  if (drawingAnnotation.value !== null && rect.value) {
    const ann = annotations.value[drawingAnnotation.value]
    ann.w = event.clientX - rect.value.x - ann.x
    ann.h = event.clientY - rect.value.y - ann.y
    return
  }
  if (!dragging.value) return
  rect.value = {
    x: Math.min(startX.value, event.clientX),
    y: Math.min(startY.value, event.clientY),
    w: Math.abs(event.clientX - startX.value),
    h: Math.abs(event.clientY - startY.value)
  }
}

function onMouseUp(): void {
  if (drawingAnnotation.value !== null) {
    const ann = annotations.value[drawingAnnotation.value]
    if (ann && ann.type !== 'text' && Math.abs(ann.w) < 4 && Math.abs(ann.h) < 4) {
      annotations.value.splice(drawingAnnotation.value, 1)
    }
    drawingAnnotation.value = null
    return
  }
  dragging.value = false
  if (rect.value && (rect.value.w < 4 || rect.value.h < 4)) rect.value = null
}

function cancel(): void {
  void window.pantry.captureDone(new ArrayBuffer(0), false)
}

async function confirm(send: boolean): Promise<void> {
  const r = rect.value
  if (!r || !dataUrl.value) return
  const img = new Image()
  img.src = dataUrl.value
  await img.decode()
  const k = scale.value
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(r.w * k)
  canvas.height = Math.round(r.h * k)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(
    img,
    Math.round(r.x * k),
    Math.round(r.y * k),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  drawAnnotations(ctx, k)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  await window.pantry.captureDone(await blob.arrayBuffer(), send)
}

function inSelection(x: number, y: number): boolean {
  const r = rect.value
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

function startAnnotation(event: MouseEvent): void {
  const r = rect.value
  if (!r) return
  const activeTool = tool.value
  if (activeTool === 'select') return
  const x = event.clientX - r.x
  const y = event.clientY - r.y
  if (activeTool === 'text') {
    const text = window.prompt('输入标注文字')?.trim()
    if (text) annotations.value.push({ type: 'text', x, y, w: 0, h: 0, text: text.slice(0, 80) })
    return
  }
  const ann: Annotation = { type: activeTool, x, y, w: 0, h: 0 }
  annotations.value.push(ann)
  drawingAnnotation.value = annotations.value.length - 1
}

function norm(ann: Annotation): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(ann.x, ann.x + ann.w),
    y: Math.min(ann.y, ann.y + ann.h),
    w: Math.abs(ann.w),
    h: Math.abs(ann.h)
  }
}

function annStyle(ann: Annotation): Record<string, string> {
  if (ann.type === 'arrow') return arrowStyle(ann)
  const n = norm(ann)
  return { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px` }
}

function arrowStyle(ann: Annotation): Record<string, string> {
  const len = Math.hypot(ann.w, ann.h)
  const deg = (Math.atan2(ann.h, ann.w) * 180) / Math.PI
  return {
    left: `${ann.x}px`,
    top: `${ann.y}px`,
    width: `${len}px`,
    transform: `rotate(${deg}deg)`
  }
}

function drawAnnotations(ctx: CanvasRenderingContext2D, k: number): void {
  ctx.save()
  ctx.lineWidth = Math.max(2, 3 * k)
  ctx.strokeStyle = '#3d8b6b'
  ctx.fillStyle = '#3d8b6b'
  for (const ann of annotations.value) {
    if (ann.type === 'rect') {
      const n = norm(ann)
      ctx.strokeRect(n.x * k, n.y * k, n.w * k, n.h * k)
    } else if (ann.type === 'arrow') {
      drawArrow(ctx, ann.x * k, ann.y * k, (ann.x + ann.w) * k, (ann.y + ann.h) * k)
    } else if (ann.type === 'text' && ann.text) {
      ctx.font = `${Math.round(18 * k)}px sans-serif`
      ctx.fillText(ann.text, ann.x * k, ann.y * k)
    } else if (ann.type === 'mosaic') {
      drawMosaic(ctx, norm(ann), k)
    }
  }
  ctx.restore()
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = 12
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function drawMosaic(ctx: CanvasRenderingContext2D, rect_: { x: number; y: number; w: number; h: number }, k: number): void {
  const x = Math.max(0, Math.round(rect_.x * k))
  const y = Math.max(0, Math.round(rect_.y * k))
  const w = Math.max(1, Math.round(rect_.w * k))
  const h = Math.max(1, Math.round(rect_.h * k))
  const block = Math.max(6, Math.round(10 * k))
  const data = ctx.getImageData(x, y, w, h)
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const idx = ((Math.min(by, h - 1) * w + Math.min(bx, w - 1)) * 4)
      ctx.fillStyle = `rgb(${data.data[idx]}, ${data.data[idx + 1]}, ${data.data[idx + 2]})`
      ctx.fillRect(x + bx, y + by, Math.min(block, w - bx), Math.min(block, h - by))
    }
  }
}
</script>

<template>
  <div
    class="stage"
    :style="{ backgroundImage: `url(${dataUrl})` }"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <div class="dim"></div>
    <template v-if="rect">
      <div
        class="sel"
        :class="{ annotating: tool !== 'select' }"
        :style="{
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.w}px`,
          height: `${rect.h}px`,
          backgroundImage: `url(${dataUrl})`,
          backgroundPosition: `-${rect.x}px -${rect.y}px`
        }"
      >
        <div
          v-for="(ann, idx) in annotations"
          :key="idx"
          class="ann"
          :class="ann.type"
          :style="annStyle(ann)"
        >
          <span v-if="ann.type === 'text'">{{ ann.text }}</span>
        </div>
      </div>
      <div
        v-if="!dragging"
        class="bar"
        :style="{
          left: `${Math.max(8, Math.min(rect.x, rect.x + rect.w - 560))}px`,
          top: `${rect.y + rect.h + 8}px`
        }"
        @mousedown.stop
      >
        <span class="size">{{ Math.round(rect.w) }} × {{ Math.round(rect.h) }}</span>
        <button class="btn tool" :class="{ on: tool === 'select' }" @click="tool = 'select'">
          选择
        </button>
        <button class="btn tool" :class="{ on: tool === 'rect' }" @click="tool = 'rect'">
          矩形
        </button>
        <button class="btn tool" :class="{ on: tool === 'arrow' }" @click="tool = 'arrow'">
          箭头
        </button>
        <button class="btn tool" :class="{ on: tool === 'text' }" @click="tool = 'text'">
          文字
        </button>
        <button class="btn tool" :class="{ on: tool === 'mosaic' }" @click="tool = 'mosaic'">
          马赛克
        </button>
        <button class="btn primary" @click="confirm(true)">发送</button>
        <button class="btn" @click="confirm(false)">复制</button>
        <button class="btn" @click="cancel">取消</button>
      </div>
    </template>
    <div v-else class="hint">拖拽框选区域 · Esc 取消</div>
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  background-size: 100% 100%;
  cursor: crosshair;
  user-select: none;
  overflow: hidden;
}
.dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.sel {
  position: absolute;
  border: 2px solid #3d8b6b;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
  background-size: 100vw 100vh;
  background-repeat: no-repeat;
  pointer-events: none;
  overflow: hidden;
}
.ann {
  position: absolute;
  pointer-events: none;
}
.ann.rect {
  border: 3px solid #3d8b6b;
}
.ann.mosaic {
  background:
    linear-gradient(45deg, rgba(61, 139, 107, 0.35) 25%, transparent 25%) 0 0 / 12px 12px,
    linear-gradient(45deg, transparent 75%, rgba(61, 139, 107, 0.35) 75%) 0 0 / 12px 12px,
    rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
}
.ann.arrow {
  height: 3px;
  background: #3d8b6b;
  transform-origin: 0 50%;
}
.ann.arrow::after {
  content: '';
  position: absolute;
  right: -1px;
  top: -5px;
  border-left: 12px solid #3d8b6b;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
}
.ann.text {
  color: #3d8b6b;
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.85);
}
.bar {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(28, 28, 28, 0.92);
  border-radius: 6px;
  padding: 6px 10px;
}
.size {
  color: #bbb;
  font-size: 12px;
  margin-right: 4px;
}
.btn {
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  color: #eee;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}
.btn.primary {
  background: #3d8b6b;
  color: #fff;
}
.btn.tool.on {
  background: rgba(61, 139, 107, 0.85);
  color: #fff;
}
.hint {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.5);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 14px;
  pointer-events: none;
}
</style>
