<script setup lang="ts">
// 沉浸式拖拽带（决议 #49/#52）：窗口顶部 32px 隐形区域，可拖动窗口、双击最大化/还原。
// macOS / Windows 用 CSS 拖拽区（-webkit-app-region: drag，系统级实现）；
// Linux 上 Electron 的 CSS 拖拽区命中计算不可靠（UOS 实测会吞掉客户区点击），
// 改为 Pointer Capture + 主进程光标跟随的 JS 拖拽，行为对用户无差异。
import { onMounted, onUnmounted, ref } from 'vue'

const jsDrag = ref(false)
const cssDrag = ref(false)
let dragging = false

onMounted(async () => {
  const info = await window.pantry.getAppInfo()
  jsDrag.value = info.platform === 'linux'
  cssDrag.value = !jsDrag.value
})

onUnmounted(() => {
  if (dragging) void window.pantry.endWindowDrag()
})

function onPointerDown(event: PointerEvent): void {
  if (!jsDrag.value || event.button !== 0) return
  dragging = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  void window.pantry.beginWindowDrag()
}

function onPointerUp(): void {
  if (!dragging) return
  dragging = false
  void window.pantry.endWindowDrag()
}

function onDoubleClick(): void {
  if (!jsDrag.value) return
  void window.pantry.toggleMaximizeWindow()
}
</script>

<template>
  <div
    class="drag-strip"
    :class="{ 'css-drag': cssDrag }"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="onDoubleClick"
  ></div>
</template>

<style scoped>
.drag-strip {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  /* z 在常规内容之上、全屏弹层之下：弹层遮罩自然盖住拖拽带，顶部交互不受影响 */
  z-index: 12;
}
.drag-strip.css-drag {
  -webkit-app-region: drag;
}
</style>
