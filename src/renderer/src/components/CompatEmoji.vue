<script setup lang="ts">
import { computed } from 'vue'
import { compatEmojiItem } from '../utils/compat-emoji'

const props = defineProps<{ emoji: string }>()

const item = computed(() => compatEmojiItem(props.emoji))
const kind = computed(() => item.value?.kind ?? 'badge')
const mark = computed(() => item.value?.mark || '')
const label = computed(() => item.value?.label ?? props.emoji)
const isFace = computed(() => kind.value.startsWith('face-'))
const faceClass = computed(() => kind.value.replace('face-', ''))
const badgeColor = computed(() => {
  if (kind.value === 'heart' || kind.value === 'heart-broken') return '#F05A6E'
  if (kind.value === 'fire') return '#F2763A'
  if (kind.value === 'party' || kind.value === 'spark' || kind.value === 'star') return '#F3A83B'
  if (kind.value === 'sun') return '#F7C948'
  if (kind.value === 'rain' || kind.value === 'rainbow') return '#5A91D6'
  if (kind.value === 'drink') return '#3D8B6B'
  if (kind.value === 'eyes') return '#7C8AA0'
  return '#5E83C4'
})
</script>

<template>
  <span class="compat-emoji" :title="label" :aria-label="label">
    <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
      <g v-if="isFace" class="face" :class="faceClass">
        <circle cx="16" cy="16" r="14" fill="#FFD766" />
        <circle v-if="faceClass !== 'wink' && faceClass !== 'roll'" cx="11.2" cy="13" r="1.7" fill="#5A3D2B" />
        <path v-if="faceClass === 'wink'" d="M9.5 13.2h4" class="line dark" />
        <circle v-if="faceClass === 'roll'" cx="10.8" cy="12.2" r="1.5" fill="#5A3D2B" />
        <circle v-if="faceClass === 'roll'" cx="20.8" cy="12.2" r="1.5" fill="#5A3D2B" />
        <circle v-else cx="20.8" cy="13" r="1.7" fill="#5A3D2B" />
        <path v-if="faceClass === 'grin'" d="M10 19h12c-.9 4-11.1 4-12 0Z" fill="#fff" stroke="#5A3D2B" stroke-width="1.5" />
        <path v-else-if="faceClass === 'joy'" d="M10 19c2 4 10 4 12 0" class="line dark" />
        <path v-else-if="faceClass === 'love'" d="M10 19c2 3 10 3 12 0" class="line dark" />
        <path v-else-if="faceClass === 'cry'" d="M11 21c2-2 8-2 10 0" class="line dark" />
        <path v-else-if="faceClass === 'shock'" d="M16 20m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0" fill="#5A3D2B" />
        <path v-else-if="faceClass === 'mask'" d="M9.5 17h13v5h-13z" fill="#F5F7F8" stroke="#5A3D2B" stroke-width="1.4" rx="2" />
        <path v-else-if="faceClass === 'cool'" d="M10 19c2 2.2 10 2.2 12 0" class="line dark" />
        <path v-else-if="faceClass === 'angry'" d="M11 21c2-2 8-2 10 0" class="line dark" />
        <path v-else d="M10.5 19.2c2.2 2.8 8.8 2.8 11 0" class="line dark" />
        <path v-if="faceClass === 'love'" d="M8.8 9.6c.9-1.7 3.7-1.2 3.7.8 0 1.6-2 2.6-3.7 4-1.7-1.4-3.7-2.4-3.7-4 0-2 2.8-2.5 3.7-.8Z" fill="#EF4E64" />
        <path v-if="faceClass === 'love'" d="M23.2 9.6c.9-1.7 3.7-1.2 3.7.8 0 1.6-2 2.6-3.7 4-1.7-1.4-3.7-2.4-3.7-4 0-2 2.8-2.5 3.7-.8Z" fill="#EF4E64" />
        <text v-if="mark" x="16" y="27" text-anchor="middle" class="small-mark">{{ mark }}</text>
      </g>
      <g v-else-if="kind === 'heart' || kind === 'heart-broken'">
        <path d="M16 27C8.5 20.6 5 17.4 5 12.8 5 9.5 7.4 7 10.4 7c1.9 0 3.7 1 4.6 2.6C16 8 17.8 7 19.6 7 22.6 7 25 9.5 25 12.8c0 4.6-3.5 7.8-9 14.2Z" :fill="badgeColor" />
        <path v-if="kind === 'heart-broken'" d="M16.8 8.5 13.8 15h4l-3.2 8.5" class="line light" />
      </g>
      <g v-else-if="kind === 'fire'">
        <path d="M17 29c6-2 8.5-6.2 7.2-11.3-.8-3.1-3.5-5-4.2-8.8-3.6 2.2-4 6.4-3.2 8.8-2.7-1.1-3.6-3.5-3.2-6.3-4.4 3.4-6.3 7.5-5 11.5C9.7 26.2 12.7 28.4 17 29Z" fill="#F2763A" />
        <path d="M16.5 26c2.8-1 4-3 3.4-5.3-.4-1.5-1.8-2.7-2-4.4-2.3 1.8-2.3 4.5-1.5 5.8-1.5-.4-2.3-1.7-2.3-3.2-2.2 2-2.9 4.1-2 5.7.7 1.1 2.1 1.7 4.4 1.4Z" fill="#FFD15A" />
      </g>
      <g v-else-if="kind === 'party' || kind === 'spark' || kind === 'star'">
        <path d="M16 4.5 19.2 12l8.1.7-6.1 5.3 1.8 8-7-4.2L9 26l1.8-8-6.1-5.3 8.1-.7L16 4.5Z" :fill="badgeColor" />
      </g>
      <g v-else-if="kind === 'sun'">
        <circle cx="16" cy="16" r="7" fill="#F7C948" />
        <path d="M16 2v5M16 25v5M2 16h5M25 16h5M6 6l3.5 3.5M22.5 22.5 26 26M26 6l-3.5 3.5M9.5 22.5 6 26" class="line sun-line" />
      </g>
      <g v-else-if="kind === 'rain'">
        <path d="M10 20h13a5 5 0 0 0 0-10 7 7 0 0 0-13-1 5.5 5.5 0 0 0 0 11Z" fill="#8DB7E8" />
        <path d="M10 23l-2 4M16 23l-2 4M22 23l-2 4" class="line rain-line" />
      </g>
      <g v-else-if="kind === 'rainbow'">
        <path d="M5 23a11 11 0 0 1 22 0" fill="none" stroke="#EF5D5D" stroke-width="4" />
        <path d="M8 23a8 8 0 0 1 16 0" fill="none" stroke="#F4C542" stroke-width="4" />
        <path d="M11 23a5 5 0 0 1 10 0" fill="none" stroke="#4FAE76" stroke-width="4" />
      </g>
      <g v-else-if="kind === 'eyes'">
        <ellipse cx="11.5" cy="16" rx="5" ry="7" fill="#fff" stroke="#6E7885" stroke-width="1.4" />
        <ellipse cx="20.5" cy="16" rx="5" ry="7" fill="#fff" stroke="#6E7885" stroke-width="1.4" />
        <circle cx="12.6" cy="16" r="2.2" fill="#435061" />
        <circle cx="21.6" cy="16" r="2.2" fill="#435061" />
      </g>
      <g v-else>
        <circle cx="16" cy="16" r="14" :fill="badgeColor" />
        <text x="16" y="20.6" text-anchor="middle" class="badge-mark">{{ mark }}</text>
      </g>
    </svg>
  </span>
</template>

<style scoped>
.compat-emoji {
  width: 1.35em;
  height: 1.35em;
  display: inline-grid;
  place-items: center;
  vertical-align: -0.22em;
  line-height: 1;
}
.compat-emoji svg {
  width: 100%;
  height: 100%;
  display: block;
}
.line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}
.dark {
  stroke: #5a3d2b;
}
.light {
  stroke: #fff;
}
.sun-line {
  stroke: #f7c948;
}
.rain-line {
  stroke: #5a91d6;
}
.badge-mark {
  fill: #fff;
  font-family: 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
  font-size: 10px;
  font-weight: 700;
}
.small-mark {
  fill: #5a3d2b;
  font-family: Arial, sans-serif;
  font-size: 7px;
  font-weight: 700;
}
.cool circle:nth-of-type(1),
.cool circle:nth-of-type(2) {
  fill: #263238;
}
.angry circle {
  fill: #5a3d2b;
}
</style>
