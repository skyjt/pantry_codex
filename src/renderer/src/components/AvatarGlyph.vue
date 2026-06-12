<script setup lang="ts">
import { computed } from 'vue'
import { AVATAR_EMOJIS } from '../utils/avatar'
import { emojiToTwemojiCode, twemojiUrl } from '../utils/twemoji-assets'

const props = defineProps<{ index: number }>()

const emoji = computed(() => AVATAR_EMOJIS[props.index] ?? AVATAR_EMOJIS[0])
const src = computed(() => twemojiUrl(emojiToTwemojiCode(emoji.value)))
</script>

<template>
  <img v-if="src" class="avatar-glyph" :src="src" alt="" aria-hidden="true" draggable="false" />
  <span v-else class="avatar-fallback">{{ emoji }}</span>
</template>

<style scoped>
.avatar-glyph {
  width: 78%;
  height: 78%;
  display: block;
  object-fit: contain;
  pointer-events: none;
}
.avatar-fallback {
  font-size: 0.78em;
  line-height: 1;
}
</style>
