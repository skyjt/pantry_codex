<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePeersStore } from '../stores/peers'
import { useChatStore } from '../stores/chat'
import { useGroupsStore } from '../stores/groups'
import { useTransfersStore } from '../stores/transfers'
import { splitEmojiText } from '../utils/compat-emoji'
import { listTime, separatorTime } from '../utils/time'
import AvatarMark from './AvatarMark.vue'
import CompatEmoji from './CompatEmoji.vue'
import FileCard from './FileCard.vue'
import ImageBubble from './ImageBubble.vue'
import EmojiPanel from './EmojiPanel.vue'
import GroupPanel from './GroupPanel.vue'
import ForwardDialog from './ForwardDialog.vue'
import PantryIcon from './PantryIcon.vue'
import type {
  ConversationMessageHit,
  ConversationSearchKind,
  MessageView,
  PeerView,
  SettingsView
} from '../../../shared/ipc'
import { RECALL_WINDOW_MS, TEXT_TCP_LIMIT, TEXT_UDP_LIMIT } from '../../../shared/protocol'

const peersStore = usePeersStore()
const chatStore = useChatStore()
const groupsStore = useGroupsStore()
const transfersStore = useTransfersStore()
transfersStore.init()

const draft = ref('')
const dragging = ref(false)
const showEmoji = ref(false)
const showHistorySearch = ref(false)
const showMembers = ref(false)
const showMentionPicker = ref(false)
const mentionIds = ref<string[]>([])
const pendingMentionAt = ref<number | null>(null)
const loadingEarlier = ref(false)
const scrollArea = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const emojiScope = ref<HTMLElement | null>(null)
const peerProfileScope = ref<HTMLElement | null>(null)
const historySearchInput = ref<HTMLInputElement | null>(null)
const msgMenu = ref<{ x: number; y: number; msg: MessageView } | null>(null)
const forwardMsg = ref<MessageView | null>(null)
const settings = ref<SettingsView | null>(null)
let stopSettings: (() => void) | null = null
let historySearchTimer: ReturnType<typeof setTimeout> | null = null
let peerProfileSavedTimer: ReturnType<typeof setTimeout> | null = null
let historySearchRun = 0
const MSG_MENU_WIDTH = 112
const MSG_MENU_ITEM_HEIGHT = 32
const MSG_MENU_PADDING = 10
const MENU_MARGIN = 8
interface TextPart {
  text: string
  url: string
}
interface HistoryCalendarDay {
  key: string
  label: number
  inMonth: boolean
  isToday: boolean
  isStart: boolean
  isEnd: boolean
  inRange: boolean
}

const historyQuery = ref('')
const historyKind = ref<ConversationSearchKind>('all')
const historyFrom = ref('')
const historyTo = ref('')
const historyCalendarMonth = ref(monthKey(new Date()))
const historyHits = ref<ConversationMessageHit[]>([])
const historySearching = ref(false)
const historyBrokenImages = ref<Record<string, boolean>>({})
const showPeerProfile = ref(false)
const peerProfileRemark = ref('')
const peerProfileSaving = ref(false)
const peerProfileSaved = ref(false)

const isGroup = computed(() => chatStore.activeConv?.type === 'group')
const group = computed(() =>
  isGroup.value && chatStore.activeConv
    ? (groupsStore.byId[chatStore.activeConv.peerId] ?? null)
    : null
)
const peer = computed(() => {
  const conv = chatStore.activeConv
  if (!conv || conv.type === 'group') return null
  return peersStore.peers.find((p) => p.nodeId === conv.peerId) ?? null
})
const peerName = computed(() => {
  if (isGroup.value) return group.value?.name ?? '讨论组'
  return peer.value ? peer.value.remark || peer.value.nick : '未知节点'
})
const peerIp = computed(() => peer.value?.ip ?? '')
const peerOnline = computed(() => peer.value?.online ?? false)
/** 群：成员才可发；单聊：文本随时可发（离线走补发） */
const canSend = computed(() => (isGroup.value ? (group.value?.amMember ?? false) : true))
const onlineGroupRecipientCount = computed(() => {
  if (!group.value) return 0
  return group.value.members.filter((id) => {
    if (id === chatStore.selfId) return false
    return peersStore.byId(id)?.online ?? false
  }).length
})
const canSendMedia = computed(() =>
  isGroup.value ? canSend.value && onlineGroupRecipientCount.value > 0 : peerOnline.value
)
const mentionMembers = computed(() =>
  group.value ? group.value.members.filter((id) => id !== chatStore.selfId) : []
)
const inputPlaceholder = computed(() => {
  if (!canSend.value) return '你已不在该讨论组，无法发言'
  return settings.value?.sendKey === 'ctrlEnter'
    ? '输入消息，Ctrl+Enter 发送，Enter 换行；粘贴截图直接发送'
    : '输入消息，Enter 发送，Ctrl+Enter 换行；粘贴截图直接发送'
})
const historyResultMeta = computed(() => {
  if (historySearching.value) return '搜索中'
  return `${historyHits.value.length} 条结果`
})
const HISTORY_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const historyDateRangeLabel = computed(() => {
  if (historyFrom.value && historyTo.value) {
    return `${compactDateLabel(historyFrom.value)} 至 ${compactDateLabel(historyTo.value)}`
  }
  if (historyFrom.value) return `${compactDateLabel(historyFrom.value)} 起`
  return '全部日期'
})
const historyCalendarTitle = computed(() => {
  const base = monthDate(historyCalendarMonth.value)
  return `${base.getFullYear()}年${base.getMonth() + 1}月`
})
const historyCalendarDays = computed<HistoryCalendarDay[]>(() => {
  const base = monthDate(historyCalendarMonth.value)
  const first = new Date(base.getFullYear(), base.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)
  const today = dateKey(new Date())
  const from = historyFrom.value
  const to = historyTo.value
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    const key = dateKey(day)
    const isStart = key === from
    const isEnd = key === to
    return {
      key,
      label: day.getDate(),
      inMonth: day.getMonth() === base.getMonth(),
      isToday: key === today,
      isStart,
      isEnd,
      inRange: Boolean(from && to && key > from && key < to)
    }
  })
})

function onDocumentPointerDown(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (showEmoji.value && !emojiScope.value?.contains(target)) showEmoji.value = false
  if (showPeerProfile.value && !peerProfileScope.value?.contains(target)) closePeerProfile()
}

onMounted(async () => {
  document.addEventListener('mousedown', onDocumentPointerDown)
  settings.value = await window.pantry.getSettings()
  stopSettings = window.pantry.onSettingsUpdated((next) => {
    settings.value = next
  })
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown)
  if (historySearchTimer) clearTimeout(historySearchTimer)
  if (peerProfileSavedTimer) clearTimeout(peerProfileSavedTimer)
  historySearchRun += 1
  stopSettings?.()
})

watch(
  () => chatStore.activeConv?.peerId,
  (id) => {
    showMembers.value = false
    showMentionPicker.value = false
    showHistorySearch.value = false
    closePeerProfile()
    mentionIds.value = []
    resetHistorySearch()
    if (isGroup.value && id) void groupsStore.ensure(id)
  },
  { immediate: true }
)

watch([historyQuery, historyKind, historyFrom, historyTo], () => scheduleHistorySearch())

watch(
  () => [peer.value?.nodeId ?? '', peer.value?.remark ?? ''] as const,
  () => {
    if (showPeerProfile.value) return
    peerProfileRemark.value = peer.value?.remark ?? ''
    peerProfileSaved.value = false
  }
)

function senderName(msg: MessageView): string {
  return peersStore.nameOf(msg.senderId)
}

function senderPeer(msg: MessageView): PeerView | undefined {
  return peersStore.byId(msg.senderId)
}

function showGroupSender(msg: MessageView): boolean {
  return isGroup.value && !msg.isMine && msg.kind !== 'system' && msg.status !== 'recalled'
}

const draftBytes = computed(() => new TextEncoder().encode(draft.value.trim()).length)
const overUdpLimit = computed(() => draftBytes.value > TEXT_UDP_LIMIT)
const overLimit = computed(() => draftBytes.value > TEXT_TCP_LIMIT)

/** 与上一条间隔 >5 分钟时插时间分隔（ui-design §5） */
function needSeparator(msg: MessageView, index: number): boolean {
  if (index === 0) return true
  return msg.ts - chatStore.activeMessages[index - 1].ts > 5 * 60_000
}

function scrollToBottom(): void {
  void nextTick(() => {
    const el = scrollArea.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(() => chatStore.activeConvId, scrollToBottom)
// 只在"末尾追加"时贴底（向上加载历史是前插，不该滚动）
watch(
  () => {
    const list = chatStore.activeMessages
    return list.length > 0 ? list[list.length - 1].id : ''
  },
  (id, oldId) => {
    if (id && id !== oldId) scrollToBottom()
  }
)
// 搜索跳转高亮：滚动到目标消息居中
watch(
  () => chatStore.highlightId,
  (id) => {
    if (!id) return
    void nextTick(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center' })
    })
  },
  { immediate: true }
)

/** 滚到顶部附近 → 向上加载更早历史，并保持视口位置不跳（F-MSG-5） */
async function onScroll(): Promise<void> {
  const el = scrollArea.value
  if (!el || el.scrollTop > 40 || loadingEarlier.value) return
  loadingEarlier.value = true
  const prevHeight = el.scrollHeight
  const loaded = await chatStore.loadEarlier()
  if (loaded > 0) {
    await nextTick()
    el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop
  }
  loadingEarlier.value = false
}

function resetHistorySearch(): void {
  if (historySearchTimer) {
    clearTimeout(historySearchTimer)
    historySearchTimer = null
  }
  historySearchRun += 1
  historyQuery.value = ''
  historyKind.value = 'all'
  historyFrom.value = ''
  historyTo.value = ''
  historyCalendarMonth.value = monthKey(new Date())
  historyHits.value = []
  historySearching.value = false
  historyBrokenImages.value = {}
}

function closePeerProfile(): void {
  showPeerProfile.value = false
  peerProfileSaving.value = false
  peerProfileSaved.value = false
  if (peerProfileSavedTimer) {
    clearTimeout(peerProfileSavedTimer)
    peerProfileSavedTimer = null
  }
}

function openPeerProfile(): void {
  const current = peer.value
  if (!current) return
  showEmoji.value = false
  closeHistorySearch()
  peerProfileRemark.value = current.remark
  peerProfileSaved.value = false
  showPeerProfile.value = true
}

function togglePeerProfile(): void {
  if (showPeerProfile.value) {
    closePeerProfile()
    return
  }
  openPeerProfile()
}

function closeHistorySearch(): void {
  showHistorySearch.value = false
  if (historySearchTimer) {
    clearTimeout(historySearchTimer)
    historySearchTimer = null
  }
  historySearching.value = false
  historySearchRun += 1
  historyBrokenImages.value = {}
}

function toggleHistorySearch(): void {
  closePeerProfile()
  showHistorySearch.value = !showHistorySearch.value
  if (!showHistorySearch.value) {
    closeHistorySearch()
    return
  }
  historyCalendarMonth.value = historyFrom.value
    ? historyFrom.value.slice(0, 7)
    : monthKey(new Date())
  scheduleHistorySearch()
  void nextTick(() => historySearchInput.value?.focus())
}

function clearHistorySearch(): void {
  resetHistorySearch()
  scheduleHistorySearch()
  void nextTick(() => historySearchInput.value?.focus())
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

function monthDate(key: string): Date {
  const matched = /^(\d{4})-(\d{2})$/.exec(key)
  if (!matched) return new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  return new Date(Number(matched[1]), Number(matched[2]) - 1, 1)
}

function compactDateLabel(value: string): string {
  return value.replace(/-/g, '.')
}

function moveHistoryMonth(offset: number): void {
  const base = monthDate(historyCalendarMonth.value)
  base.setMonth(base.getMonth() + offset)
  historyCalendarMonth.value = monthKey(base)
}

function pickHistoryDate(key: string): void {
  historyCalendarMonth.value = key.slice(0, 7)
  if (!historyFrom.value || historyTo.value) {
    historyFrom.value = key
    historyTo.value = ''
    return
  }
  if (key < historyFrom.value) {
    historyTo.value = historyFrom.value
    historyFrom.value = key
    return
  }
  historyTo.value = key
}

function clearHistoryDateRange(): void {
  historyFrom.value = ''
  historyTo.value = ''
  historyCalendarMonth.value = monthKey(new Date())
}

function peerOrgPath(p: PeerView): string {
  return [p.company, p.dept, p.team].filter(Boolean).join(' / ') || '未分组'
}

function peerPlatformLabel(platform: PeerView['platform']): string {
  if (platform === 'win') return 'Windows'
  if (platform === 'mac') return 'macOS'
  return 'Linux'
}

function peerLastSeenLabel(p: PeerView): string {
  if (p.online) return '当前在线'
  if (!p.lastSeen) return '离线'
  return listTime(p.lastSeen)
}

async function savePeerProfileRemark(): Promise<void> {
  const current = peer.value
  if (!current || peerProfileSaving.value) return
  const next = peerProfileRemark.value.trim()
  peerProfileSaving.value = true
  try {
    await window.pantry.setPeerRemark(current.nodeId, next)
    peerProfileRemark.value = next
    peerProfileSaved.value = true
    if (peerProfileSavedTimer) clearTimeout(peerProfileSavedTimer)
    peerProfileSavedTimer = setTimeout(() => {
      peerProfileSaved.value = false
      peerProfileSavedTimer = null
    }, 1500)
  } finally {
    peerProfileSaving.value = false
  }
}

function dayStart(value: string): number | undefined {
  if (!value) return undefined
  const ts = new Date(`${value}T00:00:00`).getTime()
  return Number.isFinite(ts) ? ts : undefined
}

function dayEnd(value: string): number | undefined {
  if (!value) return undefined
  const ts = new Date(`${value}T23:59:59.999`).getTime()
  return Number.isFinite(ts) ? ts : undefined
}

function scheduleHistorySearch(): void {
  if (historySearchTimer) clearTimeout(historySearchTimer)
  if (!showHistorySearch.value || !chatStore.activeConvId) {
    historyHits.value = []
    historySearching.value = false
    return
  }
  historySearching.value = true
  historySearchTimer = setTimeout(() => {
    historySearchTimer = null
    void runHistorySearch()
  }, 200)
}

async function runHistorySearch(): Promise<void> {
  const convId = chatStore.activeConvId
  if (!convId) {
    historyHits.value = []
    historySearching.value = false
    return
  }
  const run = ++historySearchRun
  const hits = await window.pantry.searchMessages({
    convId,
    query: historyQuery.value,
    kind: historyKind.value,
    fromTs: dayStart(historyFrom.value),
    toTs: dayEnd(historyTo.value),
    limit: 50
  })
  if (run !== historySearchRun) return
  historyHits.value = hits
  historyBrokenImages.value = {}
  historySearching.value = false
}

function historyIcon(hit: ConversationMessageHit): string {
  if (hit.kind === 'image') return 'image'
  if (hit.kind === 'file') return 'file'
  return 'chat'
}

function historyPrimary(hit: ConversationMessageHit): string {
  if (hit.kind === 'image') return '图片消息'
  return hit.kind === 'text' ? '文本消息' : hit.title
}

function historySecondary(hit: ConversationMessageHit): string {
  const who = hit.isMine ? '我' : peersStore.nameOf(hit.senderId)
  return `${who} · ${listTime(hit.ts)}`
}

function historyImageSrc(hit: ConversationMessageHit): string {
  if (hit.kind !== 'image' || historyBrokenImages.value[hit.msgId]) return ''
  return hit.fileRef?.transferId ? `pantry-img://${hit.fileRef.transferId}` : ''
}

function markHistoryImageBroken(msgId: string): void {
  historyBrokenImages.value = { ...historyBrokenImages.value, [msgId]: true }
}

async function openHistoryHit(hit: ConversationMessageHit): Promise<void> {
  closeHistorySearch()
  await chatStore.jumpToMessage(hit.convId, hit.seq, hit.msgId)
}

function window_startCapture(): void {
  void window.pantry.startCapture()
}

async function sendStickerById(stickerId: string): Promise<void> {
  showEmoji.value = false
  await chatStore.sendSticker(stickerId)
}

function insertEmoji(emoji: string): void {
  const ta = inputEl.value
  if (!ta) {
    draft.value += emoji
    return
  }
  const start = ta.selectionStart ?? draft.value.length
  const end = ta.selectionEnd ?? start
  draft.value = draft.value.slice(0, start) + emoji + draft.value.slice(end)
  void nextTick(() => {
    ta.focus()
    ta.selectionStart = ta.selectionEnd = start + emoji.length
  })
}

function insertNewline(): void {
  const ta = inputEl.value
  if (!ta) {
    draft.value += '\n'
    return
  }
  const start = ta.selectionStart ?? draft.value.length
  const end = ta.selectionEnd ?? start
  draft.value = draft.value.slice(0, start) + '\n' + draft.value.slice(end)
  void nextTick(() => {
    ta.focus()
    ta.selectionStart = ta.selectionEnd = start + 1
  })
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || overLimit.value || !canSend.value) return
  const mentions = isGroup.value
    ? [...new Set(mentionIds.value)].filter((id) => text.includes(`@${peersStore.nameOf(id)}`))
    : []
  draft.value = ''
  mentionIds.value = []
  showMentionPicker.value = false
  await chatStore.send(text, mentions)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === '@' && isGroup.value && canSend.value && mentionMembers.value.length > 0) {
    pendingMentionAt.value = inputEl.value?.selectionStart ?? draft.value.length
    showMentionPicker.value = true
    return
  }
  if (event.key !== 'Enter') return
  const modified = event.ctrlKey || event.metaKey
  const mode = settings.value?.sendKey ?? 'enter'
  if ((mode === 'enter' && !modified) || (mode === 'ctrlEnter' && modified)) {
    event.preventDefault()
    void send()
    return
  }
  if (mode === 'enter' && modified) {
    event.preventDefault()
    insertNewline()
  }
}

function insertMention(nodeId: string): void {
  const name = peersStore.nameOf(nodeId)
  const at = pendingMentionAt.value ?? draft.value.length
  const ta = inputEl.value
  const end = Math.max(at, ta?.selectionStart ?? at)
  draft.value = `${draft.value.slice(0, at)}@${name} ${draft.value.slice(end)}`
  mentionIds.value = [...new Set([...mentionIds.value, nodeId])]
  showMentionPicker.value = false
  pendingMentionAt.value = null
  void nextTick(() => {
    const pos = at + name.length + 2
    inputEl.value?.focus()
    if (inputEl.value) inputEl.value.selectionStart = inputEl.value.selectionEnd = pos
  })
}

function statusHint(msg: MessageView): string {
  if (msg.kind === 'file') return '' // 文件卡片自带状态行
  if (msg.status === 'recalled') return ''
  if (msg.status === 'queued') return '对方上线后自动送达'
  if (msg.status === 'failed') return '发送失败，点击重发'
  return ''
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi
const URL_TRAILING = /[),.，。!！?？;；:：]+$/

function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0]
    const index = match.index ?? 0
    const trimmed = raw.replace(URL_TRAILING, '')
    if (!trimmed) continue
    if (index > last) parts.push({ text: text.slice(last, index), url: '' })
    parts.push({ text: trimmed, url: trimmed })
    const tailStart = index + trimmed.length
    if (tailStart < index + raw.length) {
      parts.push({ text: text.slice(tailStart, index + raw.length), url: '' })
    }
    last = index + raw.length
  }
  if (last < text.length) parts.push({ text: text.slice(last), url: '' })
  return parts.length > 0 ? parts : [{ text, url: '' }]
}

function openTextLink(url: string): void {
  void window.pantry.openUrl(url)
}

function canCopyMessage(msg: MessageView): boolean {
  return msg.kind === 'text' && msg.status !== 'recalled'
}

function canRecallMessage(msg: MessageView): boolean {
  if (!msg.isMine || msg.kind !== 'text' || msg.status === 'recalled') return false
  return Date.now() - msg.ts <= RECALL_WINDOW_MS
}

function canForwardMessage(msg: MessageView): boolean {
  return msg.status !== 'recalled' && msg.kind !== 'system'
}

function messageMenuItemCount(msg: MessageView): number {
  return (
    Number(canCopyMessage(msg)) +
    Number(canForwardMessage(msg)) +
    Number(canRecallMessage(msg))
  )
}

function clampMenuPosition(
  event: MouseEvent,
  width: number,
  height: number
): { x: number; y: number } {
  const maxX = Math.max(MENU_MARGIN, window.innerWidth - width - MENU_MARGIN)
  const maxY = Math.max(MENU_MARGIN, window.innerHeight - height - MENU_MARGIN)
  return {
    x: Math.max(MENU_MARGIN, Math.min(event.clientX, maxX)),
    y: Math.max(MENU_MARGIN, Math.min(event.clientY, maxY))
  }
}

function openMessageMenu(event: MouseEvent, msg: MessageView): void {
  const itemCount = messageMenuItemCount(msg)
  if (itemCount === 0) return
  const pos = clampMenuPosition(
    event,
    MSG_MENU_WIDTH,
    itemCount * MSG_MENU_ITEM_HEIGHT + MSG_MENU_PADDING
  )
  msgMenu.value = { ...pos, msg }
}

async function copySelectedMessage(): Promise<void> {
  const msg = msgMenu.value?.msg
  msgMenu.value = null
  if (!msg || !canCopyMessage(msg)) return
  try {
    await navigator.clipboard.writeText(msg.text)
  } catch {
    // 浏览器剪贴板不可用时静默失败；不影响撤回等核心流程。
  }
}

async function recallSelectedMessage(): Promise<void> {
  const msg = msgMenu.value?.msg
  msgMenu.value = null
  if (!msg || !canRecallMessage(msg)) return
  await chatStore.recall(msg.id)
}

function forwardSelectedMessage(): void {
  const msg = msgMenu.value?.msg
  msgMenu.value = null
  if (!msg || !canForwardMessage(msg)) return
  forwardMsg.value = msg
}

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
function isImagePath(path: string): boolean {
  const lower = path.toLowerCase()
  return IMG_EXTS.some((ext) => lower.endsWith(ext))
}

async function sendFiles(directory: boolean): Promise<void> {
  if (!canSendMedia.value) return
  const paths = await window.pantry.pickFiles(directory)
  if (paths) await chatStore.sendFilePaths(paths)
}

async function sendImage(): Promise<void> {
  if (!canSendMedia.value) return
  const paths = await window.pantry.pickFiles(false)
  if (!paths) return
  for (const p of paths) {
    if (isImagePath(p)) await chatStore.sendImagePath(p)
    else await chatStore.sendFilePaths([p])
  }
}

/** 截图 Ctrl+V：剪贴板里的图片直接发送（F-MSG-3） */
async function onPaste(event: ClipboardEvent): Promise<void> {
  if (!canSendMedia.value || !event.clipboardData) return
  for (const item of Array.from(event.clipboardData.items)) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    event.preventDefault()
    const bytes = await file.arrayBuffer()
    const ext = item.type === 'image/jpeg' ? '.jpg' : '.png'
    await chatStore.sendImageBytes(`粘贴图片${ext}`, bytes)
    return
  }
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (canSendMedia.value) dragging.value = true
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragging.value = false
  if (!canSendMedia.value || !event.dataTransfer) return
  const paths: string[] = []
  for (const file of Array.from(event.dataTransfer.files)) {
    const p = (file as File & { path?: string }).path
    if (p) paths.push(p)
  }
  if (paths.length === 0) return
  // 单张图片拖入 → 按图片消息发；其余按文件
  if (paths.length === 1 && isImagePath(paths[0])) {
    await chatStore.sendImagePath(paths[0])
  } else {
    await chatStore.sendFilePaths(paths)
  }
}
</script>

<template>
  <div class="chat" @click="msgMenu = null" @dragover="onDragOver" @dragleave="dragging = false" @drop="onDrop">
    <ForwardDialog v-if="forwardMsg" :msg="forwardMsg" @close="forwardMsg = null" />
    <div
      v-if="showHistorySearch"
      class="history-overlay"
      @mousedown.self="closeHistorySearch"
      @keydown.esc.stop="closeHistorySearch"
    >
      <section
        class="history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-search-title"
        @mousedown.stop
      >
        <header class="history-dialog-head">
          <span class="history-title-block">
            <span id="history-search-title" class="history-title">搜索聊天记录</span>
            <span class="history-subtitle">{{ peerName }}</span>
          </span>
          <button type="button" class="history-close" aria-label="关闭搜索" @click="closeHistorySearch">
            <PantryIcon name="x" :size="16" />
          </button>
        </header>
        <div class="history-dialog-body">
          <aside class="history-sidebar">
            <label class="history-field">
              <span>关键词</span>
              <input
                ref="historySearchInput"
                v-model="historyQuery"
                class="history-input"
                maxlength="128"
                placeholder="搜索当前会话"
              />
            </label>
            <div class="history-field">
              <span>类型</span>
              <div class="history-segments">
                <button
                  type="button"
                  :class="{ selected: historyKind === 'all' }"
                  @click="historyKind = 'all'"
                >
                  全部
                </button>
                <button
                  type="button"
                  :class="{ selected: historyKind === 'image' }"
                  @click="historyKind = 'image'"
                >
                  图片
                </button>
                <button
                  type="button"
                  :class="{ selected: historyKind === 'file' }"
                  @click="historyKind = 'file'"
                >
                  文件
                </button>
              </div>
            </div>
            <div class="history-field">
              <span class="history-field-head">
                <span>日期</span>
                <button
                  v-if="historyFrom || historyTo"
                  type="button"
                  class="history-date-clear"
                  @click="clearHistoryDateRange"
                >
                  清除
                </button>
              </span>
              <span class="history-range-label">{{ historyDateRangeLabel }}</span>
              <div class="history-calendar">
                <div class="history-calendar-head">
                  <button type="button" aria-label="上个月" @click="moveHistoryMonth(-1)">
                    <PantryIcon name="chevron-left" :size="14" />
                  </button>
                  <span>{{ historyCalendarTitle }}</span>
                  <button type="button" aria-label="下个月" @click="moveHistoryMonth(1)">
                    <PantryIcon name="chevron-right" :size="14" />
                  </button>
                </div>
                <div class="history-weekdays">
                  <span v-for="day in HISTORY_WEEKDAYS" :key="day">{{ day }}</span>
                </div>
                <div class="history-calendar-grid">
                  <button
                    v-for="day in historyCalendarDays"
                    :key="day.key"
                    type="button"
                    class="history-day"
                    :class="{
                      out: !day.inMonth,
                      today: day.isToday,
                      'in-range': day.inRange,
                      'range-edge': day.isStart || day.isEnd
                    }"
                    @click="pickHistoryDate(day.key)"
                  >
                    {{ day.label }}
                  </button>
                </div>
              </div>
            </div>
            <button type="button" class="history-clear" @click="clearHistorySearch">清空筛选</button>
          </aside>
          <main class="history-results-panel">
            <div class="history-results-head">
              <span>结果</span>
              <span>{{ historyResultMeta }}</span>
            </div>
            <div class="history-results">
              <div v-if="historySearching" class="history-empty">搜索中...</div>
              <div v-else-if="historyHits.length === 0" class="history-empty">没有找到相关记录</div>
              <template v-else>
                <button
                  v-for="hit in historyHits"
                  :key="hit.msgId"
                  type="button"
                  class="history-hit"
                  :class="`history-hit-${hit.kind}`"
                  @click="openHistoryHit(hit)"
                >
                  <span class="history-hit-media">
                    <img
                      v-if="historyImageSrc(hit)"
                      class="history-thumb"
                      :src="historyImageSrc(hit)"
                      alt="[图片]"
                      @error="markHistoryImageBroken(hit.msgId)"
                    />
                    <span v-else class="history-kind-icon">
                      <PantryIcon :name="historyIcon(hit)" :size="18" />
                    </span>
                  </span>
                  <span class="history-hit-copy">
                    <span class="history-hit-title">{{ historyPrimary(hit) }}</span>
                    <span v-if="hit.kind === 'text'" class="history-hit-snippet">{{
                      hit.snippet
                    }}</span>
                    <span class="history-hit-meta">{{ historySecondary(hit) }}</span>
                  </span>
                </button>
              </template>
            </div>
          </main>
        </div>
      </section>
    </div>
    <div v-if="dragging" class="drop-mask">松手发送给 {{ peerName }}</div>
    <header class="head">
      <div v-if="!isGroup && peer" ref="peerProfileScope" class="peer-profile-scope">
        <button
          class="title-button"
          :class="{ active: showPeerProfile }"
          type="button"
          aria-label="查看对方资料"
          @click.stop="togglePeerProfile"
        >
          <span class="title">{{ peerName }}</span>
          <span v-if="peerIp" class="subtitle">{{ peerIp }}</span>
        </button>
        <section
          v-if="showPeerProfile"
          class="peer-profile-popover"
          role="dialog"
          aria-label="对方详细信息"
          @click.stop
          @keydown.esc.stop="closePeerProfile"
        >
          <header class="peer-profile-head">
            <AvatarMark
              class="profile-avatar"
              :avatar="peer.avatar"
              :name="peer.remark || peer.nick"
              :offline="!peer.online"
            />
            <span class="profile-title">
              <strong>{{ peer.remark || peer.nick }}</strong>
              <small v-if="peer.remark">昵称：{{ peer.nick }}</small>
              <small :class="{ on: peer.online }">{{ peer.online ? '● 在线' : '离线' }}</small>
            </span>
          </header>
          <div class="profile-rows">
            <div class="profile-row"><span>组织</span><strong>{{ peerOrgPath(peer) }}</strong></div>
            <div class="profile-row"><span>IP</span><strong>{{ peer.ip || '未知' }}</strong></div>
            <div class="profile-row"><span>主机</span><strong>{{ peer.host || '未知' }}</strong></div>
            <div class="profile-row">
              <span>平台</span><strong>{{ peerPlatformLabel(peer.platform) }}</strong>
            </div>
            <div class="profile-row">
              <span>最近</span><strong>{{ peerLastSeenLabel(peer) }}</strong>
            </div>
          </div>
          <label class="profile-remark">
            <span>备注</span>
            <input
              v-model="peerProfileRemark"
              maxlength="32"
              placeholder="仅自己可见"
              @keydown.enter="savePeerProfileRemark"
            />
          </label>
          <div class="profile-actions">
            <span class="profile-save-state">{{ peerProfileSaved ? '已保存' : '' }}</span>
            <button
              type="button"
              class="profile-save"
              :disabled="peerProfileSaving"
              @click="savePeerProfileRemark"
            >
              {{ peerProfileSaving ? '保存中' : '保存备注' }}
            </button>
          </div>
        </section>
      </div>
      <span v-else class="title-block">
        <span class="title">{{ peerName }}</span>
      </span>
      <span v-if="isGroup" class="state">{{ group?.members.length ?? 0 }} 人</span>
      <span v-else class="state" :class="{ on: peerOnline }">{{
        peerOnline ? '● 在线' : '离线'
      }}</span>
      <span class="head-spacer"></span>
      <button v-if="isGroup" class="head-btn" title="成员" @click="showMembers = !showMembers">
        <PantryIcon name="users" :size="17" />
      </button>
    </header>

    <div class="body-wrap">
      <div ref="scrollArea" class="msgs" @scroll="onScroll">
      <div v-if="loadingEarlier" class="sep">加载更早的消息…</div>
      <template v-for="(msg, i) in chatStore.activeMessages" :key="msg.id">
        <div v-if="needSeparator(msg, i)" class="sep">{{ separatorTime(msg.ts) }}</div>
        <div v-if="msg.kind === 'system'" class="system-line">{{ msg.text }}</div>
        <div
          v-else-if="msg.status !== 'recalled'"
          :id="`msg-${msg.id}`"
          class="row"
          :class="[msg.isMine ? 'mine' : 'peer', { highlight: msg.id === chatStore.highlightId }]"
        >
          <AvatarMark
            v-if="showGroupSender(msg)"
            class="msg-avatar"
            :avatar="senderPeer(msg)?.avatar ?? -1"
            :name="senderName(msg)"
          />
          <span class="message-stack">
            <span v-if="showGroupSender(msg)" class="sender">{{ senderName(msg) }}</span>
            <FileCard
              v-if="msg.kind === 'file'"
              :msg="msg"
              class="message-surface"
              @contextmenu.prevent.stop="openMessageMenu($event, msg)"
            />
            <ImageBubble
              v-else-if="msg.kind === 'image' || msg.kind === 'sticker'"
              :msg="msg"
              class="message-surface"
              @forward="forwardMsg = msg"
            />
            <div
              v-else
              class="bubble message-surface"
              @contextmenu.prevent.stop="openMessageMenu($event, msg)"
            >
              <template v-for="(part, partIndex) in textParts(msg.text)" :key="partIndex">
                <button
                  v-if="part.url"
                  class="text-link"
                  type="button"
                  @click.stop="openTextLink(part.url)"
                >
                  {{ part.text }}
                </button>
                <span v-else>
                  <template
                    v-for="(emojiPart, emojiPartIndex) in splitEmojiText(part.text)"
                    :key="emojiPartIndex"
                  >
                    <CompatEmoji v-if="emojiPart.emoji" :emoji="emojiPart.text" />
                    <span v-else>{{ emojiPart.text }}</span>
                  </template>
                </span>
              </template>
            </div>
          </span>
          <span v-if="msg.isMine" class="status">
            <PantryIcon v-if="msg.status === 'sending'" class="spin" name="loader" :size="13" />
            <PantryIcon v-else-if="msg.status === 'sent'" class="ok" name="check" :size="13" />
            <span
              v-else-if="msg.status === 'queued'"
              class="queued"
              title="对方上线后自动送达"
              @click="chatStore.resend(msg.id)"
            >
              <PantryIcon name="clock" :size="13" />
            </span>
            <span v-else class="fail" title="发送失败，点击重发" @click="chatStore.resend(msg.id)"
              >!</span
            >
          </span>
        </div>
        <div v-if="msg.isMine && statusHint(msg)" class="hint" :class="msg.status">
          {{ statusHint(msg) }}
        </div>
      </template>
      </div>
      <GroupPanel
        v-if="isGroup && showMembers && group"
        :group="group"
        :self-id="chatStore.selfId"
        @close="showMembers = false"
      />
    </div>

    <button v-if="chatStore.viewingHistory" class="back-latest" @click="chatStore.backToLatest()">
      <PantryIcon name="chevron-down" :size="14" />回到最新
    </button>

    <div
      v-if="msgMenu"
      class="msg-menu"
      :style="{ left: `${msgMenu.x}px`, top: `${msgMenu.y}px` }"
      @click.stop
    >
      <button v-if="canCopyMessage(msgMenu.msg)" @click="copySelectedMessage">复制</button>
      <button v-if="canForwardMessage(msgMenu.msg)" @click="forwardSelectedMessage">转发</button>
      <button v-if="canRecallMessage(msgMenu.msg)" class="danger" @click="recallSelectedMessage">
        撤回
      </button>
    </div>

    <footer class="input-area">
      <div class="toolbar">
        <span ref="emojiScope" class="emoji-scope">
          <EmojiPanel
            v-if="showEmoji"
            :sticker-enabled="!isGroup && peerOnline"
            @select="insertEmoji"
            @sticker="sendStickerById"
          />
          <span class="tool-wrap" data-tip="表情">
            <button
              class="tool"
              type="button"
              aria-label="表情"
              :disabled="!canSend"
              @click="showEmoji = !showEmoji"
            >
              <PantryIcon name="smile" :size="18" />
            </button>
          </span>
        </span>
        <span class="tool-wrap" data-tip="截图">
          <button
            class="tool"
            type="button"
            aria-label="截图（Ctrl/Cmd+Alt+A）"
            @click="window_startCapture"
          >
            <PantryIcon name="scissors" :size="18" />
          </button>
        </span>
        <span class="tool-wrap" data-tip="发送图片">
          <button
            class="tool"
            type="button"
            aria-label="发送图片"
            :disabled="!canSendMedia"
            @click="sendImage"
          >
            <PantryIcon name="image" :size="18" />
          </button>
        </span>
        <span class="tool-wrap" data-tip="发送文件">
          <button
            class="tool"
            type="button"
            aria-label="发送文件"
            :disabled="!canSendMedia"
            @click="sendFiles(false)"
          >
            <PantryIcon name="file" :size="18" />
          </button>
        </span>
        <span class="tool-wrap" data-tip="发送文件夹">
          <button
            class="tool"
            type="button"
            aria-label="发送文件夹"
            :disabled="!canSendMedia"
            @click="sendFiles(true)"
          >
            <PantryIcon name="folder" :size="18" />
          </button>
        </span>
        <span v-if="isGroup && canSend && onlineGroupRecipientCount === 0" class="tool-hint">
          群成员离线，无法发送图片/文件
        </span>
        <span v-else-if="isGroup" class="tool-hint">仅在线群成员可接收图片/文件</span>
        <span v-else-if="!peerOnline" class="tool-hint">对方离线，无法发送图片/文件</span>
        <span class="toolbar-spacer"></span>
        <span class="history-search-scope">
          <span class="tool-wrap" data-tip="历史搜索">
            <button
              class="tool"
              :class="{ active: showHistorySearch }"
              type="button"
              aria-label="历史搜索"
              @click="toggleHistorySearch"
            >
              <PantryIcon name="search" :size="18" />
            </button>
          </span>
        </span>
      </div>
      <div v-if="showMentionPicker" class="mention-picker">
        <button
          v-for="id in mentionMembers"
          :key="id"
          type="button"
          @mousedown.prevent="insertMention(id)"
        >
          {{ peersStore.nameOf(id) }}
        </button>
      </div>
      <textarea
        ref="inputEl"
        v-model="draft"
        class="input"
        :disabled="!canSend"
        :placeholder="inputPlaceholder"
        @keydown="onKeydown"
        @paste="onPaste"
      ></textarea>
      <div class="input-bar">
        <span v-if="draftBytes > 600" class="counter" :class="{ over: overLimit }">
          {{ draftBytes }} / {{ TEXT_TCP_LIMIT }} 字节{{
            overLimit ? '（文本过长）' : overUdpLimit ? '（将通过 TCP 发送）' : ''
          }}
        </span>
        <button class="send" :disabled="!draft.trim() || overLimit || !canSend" @click="send">
          发送
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-chat);
  position: relative;
  overflow: hidden;
}
.drop-mask {
  position: absolute;
  inset: 0;
  background: rgba(61, 139, 107, 0.12);
  border: 2px dashed var(--primary);
  display: grid;
  place-items: center;
  font-size: 15px;
  color: var(--primary);
  z-index: 5;
  pointer-events: none;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 4px;
  position: relative;
}
.toolbar-spacer {
  flex: 1;
  min-width: 8px;
}
.emoji-scope {
  display: inline-grid;
  place-items: center;
}
.history-search-scope {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
}
.mention-picker {
  position: absolute;
  left: 12px;
  bottom: 104px;
  width: 220px;
  max-height: 180px;
  overflow-y: auto;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 4;
}
.mention-picker button {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-1);
  text-align: left;
  padding: 7px 10px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.mention-picker button:hover {
  background: var(--line);
}
.row.highlight {
  animation: hl 2.4s ease;
  border-radius: 8px;
}
@keyframes hl {
  0%,
  60% {
    background: rgba(61, 139, 107, 0.16);
  }
  100% {
    background: transparent;
  }
}
.back-latest {
  position: absolute;
  right: 20px;
  bottom: 150px;
  border: 1px solid var(--line);
  background: var(--bg-window);
  border-radius: 14px;
  font-size: 12px;
  color: var(--primary);
  padding: 5px 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tool {
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  width: 30px;
  height: 28px;
  padding: 0;
  border-radius: 4px;
  display: grid;
  place-items: center;
}
.tool-wrap {
  position: relative;
  display: inline-grid;
  place-items: center;
}
.tool-wrap::before,
.tool-wrap::after {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 7px);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 4px);
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
  z-index: 30;
}
.tool-wrap::before {
  content: '';
  bottom: calc(100% + 3px);
  border: 4px solid transparent;
  border-top-color: rgba(35, 35, 35, 0.94);
}
.tool-wrap::after {
  content: attr(data-tip);
  min-width: max-content;
  max-width: 120px;
  padding: 4px 7px;
  border-radius: 4px;
  background: rgba(35, 35, 35, 0.94);
  color: #fff;
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
}
.tool-wrap:hover::before,
.tool-wrap:hover::after,
.tool-wrap:focus-within::before,
.tool-wrap:focus-within::after {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 0.45s;
}
.tool:hover:not(:disabled) {
  background: var(--line);
}
.tool.active {
  color: var(--primary);
  background: rgba(61, 139, 107, 0.1);
}
.tool:disabled {
  opacity: 0.35;
  cursor: default;
}
.tool-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}
.history-overlay {
  position: absolute;
  inset: 0;
  z-index: 18;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.16);
}
.history-dialog {
  width: min(680px, 100%);
  height: min(500px, 100%);
  min-height: 420px;
  display: flex;
  flex-direction: column;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.history-dialog-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--line);
}
.history-title-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.history-title {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
}
.history-subtitle {
  color: var(--text-3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-close {
  flex: 0 0 auto;
  width: 30px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 4px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.history-close:hover {
  background: var(--line);
}
.history-dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 218px minmax(0, 1fr);
}
.history-sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  background: var(--bg-list);
  border-right: 1px solid var(--line);
}
.history-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--text-3);
  font-size: 12px;
}
.history-field-head {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.history-date-clear {
  border: none;
  background: transparent;
  color: var(--text-3);
  padding: 0 2px;
  font-size: 12px;
  cursor: pointer;
}
.history-date-clear:hover {
  color: var(--primary);
}
.history-input {
  width: 100%;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 4px;
  outline: none;
  padding: 0 10px;
  background: var(--bg-window);
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
}
.history-input:focus {
  border-color: rgba(61, 139, 107, 0.55);
  background: var(--bg-window);
}
.history-segments {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg-window);
}
.history-segments button {
  height: 32px;
  border: none;
  border-right: 1px solid var(--line);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.history-segments button:last-child {
  border-right: none;
}
.history-segments button.selected {
  color: var(--primary);
  background: rgba(61, 139, 107, 0.1);
}
.history-clear {
  width: 100%;
  height: 32px;
  margin-top: auto;
  border: 1px solid var(--line);
  background: var(--bg-window);
  color: var(--text-2);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.history-clear:hover {
  color: var(--primary);
  border-color: rgba(61, 139, 107, 0.35);
}
.history-range-label {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg-window);
  color: var(--text-1);
  font-size: 12px;
  padding: 0 8px;
}
.history-calendar {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg-window);
  padding: 7px;
}
.history-calendar-head {
  height: 26px;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 4px;
}
.history-calendar-head span {
  text-align: center;
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
}
.history-calendar-head button {
  width: 26px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 4px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.history-calendar-head button:hover {
  background: var(--line);
  color: var(--primary);
}
.history-weekdays,
.history-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.history-weekdays {
  margin: 5px 0 3px;
}
.history-weekdays span {
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  font-size: 11px;
}
.history-calendar-grid {
  gap: 2px;
}
.history-day {
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.history-day.out {
  color: var(--text-3);
  opacity: 0.55;
}
.history-day.today:not(.range-edge) {
  box-shadow: inset 0 0 0 1px rgba(61, 139, 107, 0.38);
  color: var(--primary);
}
.history-day.in-range {
  background: rgba(61, 139, 107, 0.1);
  color: var(--primary);
}
.history-day.range-edge {
  background: var(--primary);
  color: #fff;
  opacity: 1;
}
.history-day:hover:not(.range-edge) {
  background: var(--line);
  color: var(--primary);
}
.history-results-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-window);
}
.history-results-head {
  flex: 0 0 auto;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
}
.history-results-head span:last-child {
  color: var(--text-3);
  font-size: 12px;
  font-weight: 400;
}
.history-results {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
.history-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-3);
  font-size: 12px;
}
.history-hit {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-1);
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.history-hit-image {
  grid-template-columns: 72px minmax(0, 1fr);
  min-height: 88px;
}
.history-hit + .history-hit {
  margin-top: 4px;
}
.history-hit:hover {
  background: var(--line);
}
.history-hit-media {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: var(--bg-list);
  color: var(--text-2);
}
.history-hit-image .history-hit-media,
.history-thumb {
  width: 72px;
  height: 72px;
}
.history-thumb {
  display: block;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg-list);
}
.history-kind-icon {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.history-hit-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history-hit-title {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-hit-snippet {
  min-width: 0;
  color: var(--text-2);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-hit-meta {
  color: var(--text-3);
  font-size: 11px;
}
.head {
  height: 52px;
  flex: 0 0 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  background: var(--bg-window);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: no-drag;
}
.title {
  font-size: 15px;
  font-weight: 600;
}
.title-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.title-block .title,
.title-button .title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peer-profile-scope {
  position: relative;
  min-width: 0;
  max-width: 340px;
  flex: 0 1 auto;
}
.title-button {
  min-width: 0;
  max-width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  border-radius: 4px;
  padding: 4px 6px;
  margin-left: -6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  cursor: pointer;
}
.title-button:hover,
.title-button.active {
  background: var(--line);
}
.subtitle {
  font-size: 11px;
  line-height: 1.2;
  color: var(--text-3);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peer-profile-popover {
  position: absolute;
  left: 0;
  top: calc(100% + 9px);
  width: 360px;
  z-index: 22;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-window);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.18);
}
.peer-profile-popover::before {
  content: '';
  position: absolute;
  left: 26px;
  top: -6px;
  width: 10px;
  height: 10px;
  background: var(--bg-window);
  border-left: 1px solid var(--line);
  border-top: 1px solid var(--line);
  transform: rotate(45deg);
}
.peer-profile-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.profile-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 20px;
  flex: 0 0 46px;
}
.profile-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.profile-title strong {
  min-width: 0;
  color: var(--text-1);
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-title small {
  color: var(--text-3);
  font-size: 12px;
}
.profile-title small.on {
  color: var(--online);
}
.profile-rows {
  padding: 10px 0 8px;
}
.profile-row {
  min-height: 26px;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.profile-row span {
  color: var(--text-3);
}
.profile-row strong {
  min-width: 0;
  color: var(--text-1);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-remark {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--text-3);
  font-size: 12px;
}
.profile-remark input {
  min-width: 0;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg-list);
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
  padding: 0 9px;
  outline: none;
  user-select: text;
}
.profile-remark input:focus {
  border-color: rgba(61, 139, 107, 0.55);
  background: var(--bg-window);
}
.profile-actions {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}
.profile-save-state {
  color: var(--online);
  font-size: 12px;
}
.profile-save {
  min-width: 76px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.profile-save:disabled {
  opacity: 0.55;
  cursor: default;
}
.state {
  font-size: 12px;
  color: var(--text-3);
}
.state.on {
  color: var(--online);
}
.body-wrap {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.msgs {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
}
.sender {
  font-size: 11px;
  color: var(--text-3);
  margin-left: 4px;
}
.head-spacer {
  flex: 1;
}
.head-btn {
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  width: 30px;
  height: 28px;
  padding: 0;
  border-radius: 4px;
  display: grid;
  place-items: center;
}
.head-btn:hover {
  background: var(--line);
}
.sep {
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  margin: 10px 0 6px;
}
.system-line {
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
  margin: 8px 0;
}
.row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin: 4px 0;
}
.row.mine {
  flex-direction: row-reverse;
}
.msg-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  flex: 0 0 30px;
  align-self: flex-start;
  margin-top: 18px;
}
.message-stack {
  max-width: 64%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  flex-shrink: 0;
}
.row.mine .message-stack {
  align-items: flex-end;
}
.message-surface {
  flex-shrink: 0;
}
.bubble {
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  user-select: text;
}
.row.peer .bubble {
  background: var(--bubble-peer);
}
.row.mine .bubble {
  background: var(--bubble-mine);
}
.text-link {
  border: none;
  background: transparent;
  color: var(--primary);
  font: inherit;
  line-height: inherit;
  padding: 0;
  text-decoration: underline;
  cursor: pointer;
  user-select: text;
}
.status {
  font-size: 12px;
  color: var(--text-3);
  flex-shrink: 0;
  margin-bottom: 4px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
}
.status .ok {
  color: var(--online);
}
.status .fail {
  color: var(--danger);
  cursor: pointer;
  font-weight: 700;
  padding: 0 4px;
}
.status .queued {
  cursor: pointer;
  display: grid;
  place-items: center;
}
.msg-menu {
  position: fixed;
  min-width: 96px;
  background: var(--bg-window);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 20;
}
.msg-menu button {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-1);
  text-align: left;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.msg-menu button:hover {
  background: var(--line);
}
.msg-menu button.danger {
  color: var(--danger);
}
.spin {
  display: inline-block;
  animation: rotate 1s linear infinite;
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
.hint {
  font-size: 11px;
  color: var(--text-3);
  text-align: right;
  margin: 0 28px 4px 0;
}
.hint.failed {
  color: var(--danger);
}
.input-area {
  flex: 0 0 auto;
  background: var(--bg-window);
  border-top: 1px solid var(--line);
  padding: 8px 12px 10px;
}
.input {
  width: 100%;
  height: 72px;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  background: transparent;
  user-select: text;
}
.input-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}
.counter {
  font-size: 11px;
  color: var(--text-3);
}
.counter.over {
  color: var(--danger);
}
.send {
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  padding: 6px 22px;
  border-radius: 4px;
  cursor: pointer;
}
.send:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
