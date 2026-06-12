<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ index: number }>()

const ear = computed(() => props.index % 5)
const accent = computed(() => props.index % 4)
const hasBeak = computed(() => props.index === 15 || props.index === 16)
const hasHorn = computed(() => props.index === 17)
const isWhale = computed(() => props.index === 18)
const isOctopus = computed(() => props.index === 19)
</script>

<template>
  <svg class="avatar-glyph" viewBox="0 0 48 48" focusable="false" aria-hidden="true">
    <g v-if="isWhale">
      <path d="M9 28c2.5-9 12-14 22-9 5 2.5 6 7.5 4 11-3.5 6-18 6.5-26-2Z" fill="currentColor" opacity="0.95" />
      <path d="M31 20c3-5 7-6 10-3-1 2.8-4 4.5-8.5 4.5" class="line" />
      <circle cx="23" cy="27" r="1.8" class="ink" />
      <path d="M13 27c3 3 8 4.5 14 3.5" class="line ink-stroke" />
    </g>
    <g v-else-if="isOctopus">
      <path d="M16 15c0-5 16-5 16 0v11c0 5-16 5-16 0Z" fill="currentColor" opacity="0.95" />
      <path d="M15 29c-2 4-5 5-7 3M20 30c-1 4-3 6-6 6M25 30c1 4 3 6 6 6M31 29c2 4 5 5 7 3" class="line" />
      <circle cx="21" cy="22" r="1.7" class="ink" />
      <circle cx="27" cy="22" r="1.7" class="ink" />
      <path d="M21 27c2 1.5 4 1.5 6 0" class="line ink-stroke" />
    </g>
    <g v-else>
      <path v-if="ear === 0" d="M12 16c-5-8-2-12 5-7l3 7M36 16c5-8 2-12-5-7l-3 7" fill="currentColor" opacity="0.88" />
      <circle v-if="ear === 1" cx="15" cy="13" r="7" fill="currentColor" opacity="0.88" />
      <circle v-if="ear === 1" cx="33" cy="13" r="7" fill="currentColor" opacity="0.88" />
      <path v-if="ear === 2" d="M13 16 10 5l10 7M35 16l3-11-10 7" fill="currentColor" opacity="0.88" />
      <path v-if="ear === 3" d="M16 16C9 9 9 5 15 3c4 3 5 8 4 13M32 16c7-7 7-11 1-13-4 3-5 8-4 13" fill="currentColor" opacity="0.88" />
      <path v-if="ear === 4" d="M14 16c-4-5-4-9 0-12 5 2 7 6 7 11M34 16c4-5 4-9 0-12-5 2-7 6-7 11" fill="currentColor" opacity="0.88" />
      <path v-if="hasHorn" d="M21 12 24 3l3 9" fill="#F7E5A1" />
      <circle cx="24" cy="25" r="16" fill="currentColor" opacity="0.95" />
      <path v-if="accent === 1" d="M14 18h6M28 18h6" class="line accent" />
      <path v-if="accent === 2" d="M15 17c2-2 5-2 7 0M26 17c2-2 5-2 7 0" class="line accent" />
      <path v-if="accent === 3" d="M16 14 13 9M32 14l3-5" class="line accent" />
      <circle cx="18.5" cy="23.5" r="2" class="ink" />
      <circle cx="29.5" cy="23.5" r="2" class="ink" />
      <path v-if="hasBeak" d="M20 27h8l-4 5Z" fill="#F2B84B" />
      <g v-else>
        <ellipse cx="24" cy="30" rx="8" ry="5.8" fill="#fff" opacity="0.26" />
        <circle cx="24" cy="28.5" r="1.7" class="ink" />
        <path d="M20.5 32c2 1.8 5 1.8 7 0" class="line ink-stroke" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.avatar-glyph {
  width: 76%;
  height: 76%;
  display: block;
}
.line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.accent {
  opacity: 0.56;
}
.ink {
  fill: rgba(0, 0, 0, 0.42);
}
.ink-stroke {
  stroke: rgba(0, 0, 0, 0.42);
}
</style>
