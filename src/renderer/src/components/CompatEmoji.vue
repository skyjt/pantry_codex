<script setup lang="ts">
import { computed } from 'vue'
import { compatEmojiItem } from '../utils/compat-emoji'
import { emojiToTwemojiCode, twemojiUrl } from '../utils/twemoji-assets'

const props = defineProps<{ emoji: string }>()

const item = computed(() => compatEmojiItem(props.emoji))
const label = computed(() => item.value?.label ?? props.emoji)
const src = computed(() => twemojiUrl(emojiToTwemojiCode(props.emoji)))
</script>

<template>
  <span class="compat-emoji" :title="label" :aria-label="label">
    <img v-if="src" :src="src" alt="" aria-hidden="true" draggable="false" />
    <span v-else>{{ emoji }}</span>
  </span>
</template>

<style scoped>
.compat-emoji {
  width: 1.3em;
  height: 1.3em;
  display: inline-grid;
  place-items: center;
  vertical-align: -0.24em;
  line-height: 1;
}
.compat-emoji img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  pointer-events: none;
}
</style>
