<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { MessageView, PkRefView } from '../../../shared/ipc'
import { pkResultText, pkTitle, type PkGame, type PkRpsResult } from '../../../shared/pk'
import { emojiToTwemojiCode, twemojiUrl } from '../utils/twemoji-assets'

const props = defineProps<{
  msg: MessageView
  mine: boolean
  showAction: boolean
  actionDisabled: boolean
  disabledReason: string
}>()

const emit = defineEmits<{ participate: [game: PkGame] }>()

const finalRef = computed(() => props.msg.pkRef ?? null)
const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const rolling = ref<PkRefView | null>(finalRef.value)
const settled = ref(!(finalRef.value && Date.now() - props.msg.ts < 5000 && !reduceMotion))
let tickTimer: ReturnType<typeof setInterval> | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null

const currentRef = computed(() => (settled.value ? finalRef.value : rolling.value) ?? finalRef.value)
const game = computed(() => finalRef.value?.game ?? 'dice')
const actionText = computed(() => (game.value === 'dice' ? '掷一下' : '我也来'))
const resultText = computed(() => (currentRef.value ? pkResultText(currentRef.value) : props.msg.text))
const title = computed(() => pkTitle(game.value))
const rpsSrc = computed(() => {
  const result = currentRef.value?.result
  if (game.value !== 'rps' || typeof result !== 'string') return ''
  const emoji: Record<PkRpsResult, string> = { rock: '✊', paper: '✋', scissors: '✌️' }
  return twemojiUrl(emojiToTwemojiCode(emoji[result as PkRpsResult]))
})
const diceValue = computed(() => {
  const result = currentRef.value?.result
  return typeof result === 'number' ? result : 1
})
const diceDots = computed(() => {
  const map: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  }
  return new Set(map[diceValue.value] ?? map[1])
})

onMounted(() => {
  const ref = finalRef.value
  if (!ref || settled.value) return
  tickTimer = setInterval(() => {
    rolling.value = randomRef(ref.game)
  }, 90)
  settleTimer = setTimeout(() => {
    settled.value = true
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
  }, 1500)
})

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
  if (settleTimer) clearTimeout(settleTimer)
})

function randomRef(nextGame: PkGame): PkRefView {
  if (nextGame === 'dice') return { game: 'dice', result: 1 + Math.floor(Math.random() * 6) }
  return { game: 'rps', result: ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)] as PkRpsResult }
}
</script>

<template>
  <span class="pk-wrap">
    <div class="pk-bubble" :class="{ mine }">
      <div class="pk-title">{{ title }}</div>
      <div class="pk-stage" :class="{ rolling: !settled }">
        <div v-if="game === 'dice'" class="dice-face" :aria-label="`${diceValue} 点`">
          <span v-for="index in 9" :key="index" class="dice-cell">
            <span v-if="diceDots.has(index - 1)" class="dice-dot"></span>
          </span>
        </div>
        <img v-else-if="rpsSrc" class="rps-hand" :src="rpsSrc" alt="" draggable="false" />
      </div>
      <div class="pk-result">{{ resultText }}</div>
    </div>
    <button
      v-if="showAction"
      class="pk-action"
      type="button"
      :disabled="actionDisabled"
      :title="actionDisabled ? disabledReason : actionText"
      @click="emit('participate', game)"
    >
      {{ actionText }}
    </button>
  </span>
</template>

<style scoped>
.pk-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  vertical-align: top;
}
.pk-bubble {
  box-sizing: border-box;
  width: 184px;
  padding: 9px 10px 10px;
  border-radius: 8px;
  background: var(--bubble-peer);
  border: 1px solid rgba(61, 139, 107, 0.18);
  border-left-color: rgba(61, 139, 107, 0.72);
  border-left-width: 2px;
}
.pk-bubble.mine {
  background: var(--bubble-mine);
}
.pk-title {
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  margin-bottom: 4px;
}
.pk-stage {
  height: 54px;
  display: grid;
  place-items: center;
}
.dice-face {
  width: 46px;
  height: 46px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  padding: 7px;
  border: 1.4px solid var(--text-2);
  border-radius: 8px;
  background: var(--bg-window);
}
.dice-cell {
  display: grid;
  place-items: center;
}
.dice-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-1);
}
.rps-hand {
  width: 48px;
  height: 48px;
  display: block;
}
.pk-result {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  text-align: center;
}
.pk-action {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg-window);
  color: var(--primary);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, transform 100ms ease;
}
.pk-action:hover:not(:disabled) {
  background: rgba(61, 139, 107, 0.1);
  border-color: rgba(61, 139, 107, 0.3);
}
.pk-action:active:not(:disabled) {
  transform: translateY(1px);
}
.pk-action:focus-visible {
  outline: 2px solid rgba(61, 139, 107, 0.35);
  outline-offset: 2px;
}
.pk-action:disabled {
  color: var(--text-3);
  cursor: default;
  opacity: 0.55;
}
@keyframes pk-pop {
  from {
    transform: translateY(0) scale(1);
  }
  to {
    transform: translateY(-1px) scale(1.03);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .pk-stage.rolling {
    animation: pk-pop 160ms ease-in-out infinite alternate;
  }
}
</style>
