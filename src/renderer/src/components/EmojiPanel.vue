<script setup lang="ts">
// emoji 面板（F-MSG-7 的 P0 部分）：精选常用集，点击插入输入框。
// 注：Win7 系统 emoji 为黑白残缺，twemoji 图片替换方案（tech-design §7）
// 留待 Win7 VM 冒烟时落地——展示层替换不影响消息明文与协议。

const emit = defineEmits<{ select: [emoji: string]; close: [] }>()

const EMOJIS: string[] = [
  '😀', '😄', '😁', '😂', '🤣', '😊', '😉', '😍',
  '😘', '😜', '🤔', '🤗', '😎', '🙄', '😤', '😭',
  '😱', '😴', '🤤', '😷', '🤝', '👍', '👎', '👌',
  '✌️', '🤞', '👏', '🙏', '💪', '👀', '🤦', '🤷',
  '🙋', '✋', '👋', '❤️', '💔', '💯', '🔥', '🎉',
  '🎊', '✨', '⭐', '🌟', '☀️', '🌧️', '⚡', '❄️',
  '🌈', '🍵', '☕', '🍺', '🥳', '🍰', '🍜', '🍚',
  '🍉', '🍎', '🍊', '⏰', '📌', '📎', '✅', '❌',
  '⚠️', '❓', '❗', '💤', '🚀', '🐛', '🔧', '💻',
  '📱', '📁', '📄', '✏️', '🔍', '🔒', '🆗', '💡'
]
</script>

<template>
  <div class="panel" @mouseleave="emit('close')">
    <button v-for="e in EMOJIS" :key="e" class="emo" @click="emit('select', e)">{{ e }}</button>
  </div>
</template>

<style scoped>
.panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  width: 324px;
  max-height: 220px;
  overflow-y: auto;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  z-index: 8;
}
.emo {
  border: none;
  background: transparent;
  font-size: 20px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.2;
}
.emo:hover {
  background: var(--line);
}
</style>
