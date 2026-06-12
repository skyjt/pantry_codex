<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useStickersStore } from '../stores/stickers'
import PantryIcon from './PantryIcon.vue'

// 表情面板双页签（ui-design §5）：emoji / 我的表情包。
// Win7 的 twemoji 图片替换方案（tech-design §7）留待 Win7 VM 冒烟时落地。

const emit = defineEmits<{ select: [emoji: string]; sticker: [id: string] }>()
const props = defineProps<{ stickerEnabled: boolean }>()

const tab = ref<'emoji' | 'sticker'>('emoji')
const stickers = useStickersStore()

onMounted(() => void stickers.init())

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
  <div class="panel">
    <div class="tabs">
      <button :class="{ on: tab === 'emoji' }" @click="tab = 'emoji'">
        <PantryIcon name="smile" :size="15" />表情
      </button>
      <button :class="{ on: tab === 'sticker' }" @click="tab = 'sticker'">
        <PantryIcon name="sticker" :size="15" />表情包
      </button>
    </div>

    <div v-if="tab === 'emoji'" class="grid emoji-grid">
      <button v-for="e in EMOJIS" :key="e" class="emo" @click="emit('select', e)">{{ e }}</button>
    </div>

    <div v-else class="grid sticker-grid" :class="{ 'is-empty': stickers.list.length === 0 }">
      <div
        v-for="(s, index) in stickers.list"
        :key="s.id"
        class="stk"
        :class="{ disabled: !props.stickerEnabled }"
        :title="props.stickerEnabled ? '点击发送，右键删除' : '当前会话不可发表情包'"
        @click="props.stickerEnabled && emit('sticker', s.id)"
        @contextmenu.prevent="stickers.remove(s.id)"
      >
        <img :src="`pantry-sticker://${s.id}`" alt="表情" />
        <span class="stk-actions" @click.stop>
          <button :disabled="index === 0" @click="stickers.move(s.id, -1)">
            <PantryIcon name="chevron-up" :size="12" />
          </button>
          <button :disabled="index === stickers.list.length - 1" @click="stickers.move(s.id, 1)">
            <PantryIcon name="chevron-down" :size="12" />
          </button>
        </span>
      </div>
      <p v-if="stickers.list.length === 0" class="empty">
        还没有收藏——在聊天图片上右键「添加到表情」
      </p>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  width: 324px;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
  z-index: 8;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 12px;
  padding: 8px 0;
  cursor: pointer;
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.tabs button.on {
  color: var(--primary);
  font-weight: 600;
}
.grid {
  height: 200px;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  gap: 2px;
  box-sizing: border-box;
}
.emoji-grid {
  grid-template-columns: repeat(8, 1fr);
}
.sticker-grid {
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.sticker-grid.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
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
.stk {
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  display: grid;
  place-items: center;
  background: var(--bg-list);
  position: relative;
}
.stk:hover {
  outline: 2px solid var(--primary);
}
.stk.disabled {
  opacity: 0.45;
  cursor: default;
}
.stk img {
  max-width: 100%;
  max-height: 100%;
}
.stk-actions {
  position: absolute;
  right: 3px;
  bottom: 3px;
  display: none;
  gap: 2px;
}
.stk:hover .stk-actions {
  display: flex;
}
.stk-actions button {
  border: none;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}
.stk-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}
.empty {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
  padding: 20px 8px;
}
</style>
