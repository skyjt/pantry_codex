<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { MessageView, PkRefView } from '../../../shared/ipc'
import { pkLabel, pkResultText, type PkGame, type PkRpsResult } from '../../../shared/pk'
import { emojiToTwemojiCode, twemojiUrl } from '../utils/twemoji-assets'
import PantryIcon from './PantryIcon.vue'

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
const game = computed(() => finalRef.value?.game ?? 'dice')
const label = computed(() => pkLabel(game.value))
const chipIcon = computed(() => (game.value === 'dice' ? 'pk-dice' : 'pk-rps'))
const actionText = computed(() => (game.value === 'dice' ? '掷一下' : '我也来'))

// 仅刚收发的 PK（5s 内）且未要求减弱动画时才播放揭晓动画；历史消息直接定格
const animatable = finalRef.value != null && Date.now() - props.msg.ts < 5000 && !reduceMotion
const settled = ref(!animatable)
const justSettled = ref(false)
// 3D 定格 transition 开关：骰子立方体与猜拳翻牌共用，落定时启用弹性过渡
const spinSettling = ref(false)

// 猜拳：本地轮播三枚手势；3D 翻牌正反双面同显当前手势，定格停在结果正面
const rolling = ref<PkRefView | null>(finalRef.value)
const rpsResult = computed(() => {
  const cur = settled.value ? finalRef.value : rolling.value
  return typeof cur?.result === 'string' ? (cur.result as PkRpsResult) : null
})
const rpsSrc = computed(() => {
  if (game.value !== 'rps' || !rpsResult.value) return ''
  // 石头用 👊(1f44a) 而非 ✊(270a)：本地 twemoji 资源缺 270a.svg，1f44a 已内置且同套画风（决议 #148）
  const emoji: Record<PkRpsResult, string> = { rock: '👊', paper: '✋', scissors: '✌️' }
  return twemojiUrl(emojiToTwemojiCode(emoji[rpsResult.value]))
})
const rpsRotY = ref(0)
const cardStyle = computed(() => ({
  transform: `rotateY(${rpsRotY.value}deg)`,
  transition: spinSettling.value ? 'transform 0.66s cubic-bezier(0.2, 0.85, 0.3, 1.1)' : 'none'
}))

// 骰子：CSS 3D 立方体，6 面真实点数；投掷时翻滚，定格时转到结果面朝前
const diceValue = computed(() => (typeof finalRef.value?.result === 'number' ? finalRef.value.result : 1))
// 每个点数面朝前（且点阵正立）时立方体应处的 [rotateX, rotateY]
const FACE_ANGLE: Record<number, [number, number]> = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180]
}
// 6 个面各自的点阵（九宫格落点，与 2D 骰面一致）
const FACE_DOTS: Record<number, Set<number>> = {
  1: new Set([4]),
  2: new Set([0, 8]),
  3: new Set([0, 4, 8]),
  4: new Set([0, 2, 6, 8]),
  5: new Set([0, 2, 4, 6, 8]),
  6: new Set([0, 2, 3, 5, 6, 8])
}
const initAngle = !animatable && game.value === 'dice' ? FACE_ANGLE[diceValue.value] : [0, 0]
const rotX = ref(initAngle[0])
const rotY = ref(initAngle[1])
const cubeStyle = computed(() => ({
  transform: `rotateX(${rotX.value}deg) rotateY(${rotY.value}deg)`,
  transition: spinSettling.value ? 'transform 0.74s cubic-bezier(0.2, 0.85, 0.3, 1.12)' : 'none'
}))

const resultText = computed(() => {
  if (!finalRef.value) return props.msg.text
  if (settled.value) return pkResultText(finalRef.value)
  // 揭晓动画过程中文字固定，避免「出了石头/剪刀/布」随翻牌轮播乱跳（决议 #146）；翻牌手势图仍由 rolling 轮播
  return game.value === 'dice' ? '投掷中…' : '出拳中…'
})

let tickTimer: ReturnType<typeof setInterval> | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
let revealTimer: ReturnType<typeof setTimeout> | null = null
let rafId: number | null = null

onMounted(() => {
  if (!animatable) return
  if (game.value === 'dice') {
    const step = (): void => {
      rotX.value += 9
      rotY.value += 13
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
    settleTimer = setTimeout(() => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
      const [bx, by] = FACE_ANGLE[diceValue.value]
      // 在当前累计角度基础上再多转两圈后落到结果面，保证始终正向减速到位
      spinSettling.value = true
      rotX.value = bx + 360 * (Math.round(rotX.value / 360) + 2)
      rotY.value = by + 360 * (Math.round(rotY.value / 360) + 2)
      settled.value = true
      justSettled.value = true
      revealTimer = setTimeout(() => (justSettled.value = false), 760)
    }, 1500)
  } else {
    const step = (): void => {
      rpsRotY.value += 13
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
    tickTimer = setInterval(() => {
      rolling.value = {
        game: 'rps',
        result: ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)] as PkRpsResult
      }
    }, 90)
    settleTimer = setTimeout(() => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
      if (tickTimer) clearInterval(tickTimer)
      tickTimer = null
      // 落到最近一整圈，让结果手势停在正面朝前
      spinSettling.value = true
      rpsRotY.value = 360 * (Math.round(rpsRotY.value / 360) + 1)
      settled.value = true
      justSettled.value = true
      revealTimer = setTimeout(() => (justSettled.value = false), 700)
    }, 1500)
  }
})

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
  if (settleTimer) clearTimeout(settleTimer)
  if (revealTimer) clearTimeout(revealTimer)
  if (rafId !== null) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="pk-bubble" :class="{ mine, 'has-action': showAction }">
    <div class="pk-stage" :class="{ reveal: justSettled }">
      <div v-if="game === 'dice'" class="dice-cube" :style="cubeStyle" :aria-label="`${diceValue} 点`">
        <div v-for="face in 6" :key="face" class="dice-side" :class="'s' + face">
          <span v-for="cell in 9" :key="cell" class="dice-cell">
            <span v-if="FACE_DOTS[face].has(cell - 1)" class="dice-dot"></span>
          </span>
        </div>
      </div>
      <div v-else-if="rpsSrc" class="rps-card" :style="cardStyle">
        <span class="rps-face rps-front"><img :src="rpsSrc" alt="" draggable="false" /></span>
        <span class="rps-face rps-back"><img :src="rpsSrc" alt="" draggable="false" /></span>
      </div>
    </div>
    <div class="pk-info">
      <span class="pk-label">
        <PantryIcon :name="chipIcon" :size="12" />
        <span>{{ label }}</span>
      </span>
      <span class="pk-result">{{ resultText }}</span>
    </div>
    <button
      v-if="showAction"
      class="pk-join"
      type="button"
      :disabled="actionDisabled"
      :title="actionDisabled ? disabledReason : actionText"
      @click="emit('participate', game)"
    >
      {{ actionText }}
    </button>
  </div>
</template>

<style scoped>
/* 茶青描边的明暗两套取值用局部变量承载——Chrome 108 不支持 color-mix，只能预置 rgba */
/* 横向卡（决议 #145）：开奖窗左 + 信息列中 + 参与按钮右，高度由 42px 开奖窗决定，从原 ~170px 垂直堆叠瘦身到 ~60px */
.pk-bubble {
  --pk-edge: rgba(61, 139, 107, 0.22);
  box-sizing: border-box;
  width: 132px;
  padding: 8px 9px;
  border-radius: 8px;
  background: var(--bubble-peer);
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 9px;
  overflow: hidden;
}
html[data-theme='dark'] .pk-bubble {
  --pk-edge: rgba(91, 191, 145, 0.32);
}
.pk-bubble.mine {
  background: var(--bubble-mine);
}
/* 固定卡片宽度（决议 #147）：避免「出了布」比「出了石头」短一截、动画态→定格态宽度跳变；他人含参与按钮更宽，信息列 flex:1 撑满、结果左对齐、短文字右侧留白 */
.pk-bubble.has-action {
  width: 200px;
}
/* 信息列：玩法标签（小）+ 结果文字纵向堆叠，占据开奖窗右侧 */
.pk-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.pk-label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
}
.pk-label .pantry-icon {
  color: var(--primary);
}
.pk-result {
  color: var(--text-1);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 统一开奖窗：骰子 3D 立方体与猜拳 3D 翻牌共用这一个中性凹陷窗，靠茶青描边统一；横向卡里固定 42px、不被压缩 */
.pk-stage {
  position: relative;
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 7px;
  background: var(--bg-chat);
  border: 1px solid var(--pk-edge);
  display: grid;
  place-items: center;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  perspective: 240px;
}
/* 定格瞬间一闪的茶青高亮层，opacity 驱动，不触发布局 */
.pk-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1.5px var(--primary), 0 0 6px rgba(61, 139, 107, 0.45);
  opacity: 0;
  pointer-events: none;
}
/* 3D 骰子立方体：6 面各 translateZ(14px) 撑成 28px 见方的盒子 */
.dice-cube {
  position: relative;
  width: 28px;
  height: 28px;
  transform-style: preserve-3d;
}
.dice-side {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  padding: 4px;
  background: var(--bg-window);
  border: 1px solid var(--pk-edge);
  border-radius: 5px;
  box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.07);
  backface-visibility: hidden;
}
.s1 {
  transform: rotateY(0deg) translateZ(14px);
}
.s2 {
  transform: rotateX(90deg) translateZ(14px);
}
.s3 {
  transform: rotateY(90deg) translateZ(14px);
}
.s4 {
  transform: rotateY(-90deg) translateZ(14px);
}
.s5 {
  transform: rotateX(-90deg) translateZ(14px);
}
.s6 {
  transform: rotateY(180deg) translateZ(14px);
}
.dice-cell {
  display: grid;
  place-items: center;
}
.dice-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-1);
}
/* 3D 猜拳翻牌：正反双面同显当前手势，绕 Y 轴翻转，定格停在结果手势正面 */
.rps-card {
  position: relative;
  width: 28px;
  height: 28px;
  transform-style: preserve-3d;
}
.rps-face {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  backface-visibility: hidden;
}
.rps-back {
  transform: rotateY(180deg);
}
.rps-face img {
  width: 26px;
  height: 26px;
  display: block;
}
/* 参与按钮：开奖窗右侧小胶囊，仅他人 PK 显示，hover 实底茶青强化参与召唤 */
.pk-join {
  flex: none;
  margin-left: 2px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--pk-edge);
  background: var(--primary-weak);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.pk-join:hover:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.pk-join:active:not(:disabled) {
  transform: translateY(0.5px);
}
.pk-join:focus-visible {
  outline: 2px solid rgba(61, 139, 107, 0.35);
  outline-offset: 2px;
}
.pk-join:disabled {
  color: var(--text-3);
  background: transparent;
  border-color: var(--line);
  cursor: default;
}
@keyframes pk-flash {
  0% {
    opacity: 0;
  }
  28% {
    opacity: 0.55;
  }
  100% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .pk-stage.reveal::after {
    animation: pk-flash 440ms ease-out;
  }
}
</style>
