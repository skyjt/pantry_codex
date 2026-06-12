<script setup lang="ts">
import { computed } from 'vue'
import { avatarEmojiIndex, avatarStyle, avatarText } from '../utils/avatar'
import AvatarGlyph from './AvatarGlyph.vue'

const props = defineProps<{
  avatar: number
  name: string
  offline?: boolean
}>()

const glyphIndex = computed(() => avatarEmojiIndex(props.avatar))
const markStyle = computed(() => {
  if (props.offline) return { backgroundColor: 'var(--offline)', color: '#fff' }
  return avatarStyle(props.avatar, props.name)
})
</script>

<template>
  <span class="avatar-mark" :style="markStyle">
    <AvatarGlyph v-if="glyphIndex >= 0" :index="glyphIndex" />
    <span v-else class="avatar-initial">{{ avatarText(avatar, name) }}</span>
  </span>
</template>

<style scoped>
.avatar-mark {
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  font-weight: 600;
}
.avatar-initial {
  line-height: 1;
}
</style>
