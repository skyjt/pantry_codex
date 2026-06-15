<script setup lang="ts">
import { computed } from 'vue'
import standardLogoUrl from '../assets/brand/icon-standard-logo.svg?url'
import smallLogoUrl from '../assets/brand/icon-small-16-64px.svg?url'
import monoLogoUrl from '../assets/brand/icon-macos-menubar-outline.svg?url'
import markLogoUrl from '../assets/brand/pantry-mark.svg?url'

// 茶话间品牌 logo（决议 #107）：直接复用用户给定 SVG 套件，避免手写 path 走形。
const props = withDefaults(
  defineProps<{
    variant?: 'icon' | 'color' | 'mono'
    size?: number
  }>(),
  {
    variant: 'color',
    size: 64
  }
)

const logoSrc = computed(() => {
  if (props.variant === 'mono') return monoLogoUrl
  if (props.variant === 'color') return markLogoUrl
  return props.size <= 64 ? smallLogoUrl : standardLogoUrl
})
</script>

<template>
  <img
    class="pantry-brand-logo"
    :class="`is-${props.variant}`"
    :src="logoSrc"
    :width="props.size"
    :height="props.size"
    alt="茶话间 logo"
    draggable="false"
  />
</template>

<style scoped>
.pantry-brand-logo {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
  user-select: none;
}
</style>
