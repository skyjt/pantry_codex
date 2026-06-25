<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_SHOWHIDE_SHORTCUT,
  type AppInfo,
  type AppSettingsPatch,
  type ConversationView,
  type DataExportOptions,
  type ScanRangeItemView,
  type SettingsView,
  type TransferView
} from '../../shared/ipc'
import { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT } from '../../shared/protocol'
import { applyAppearance } from './utils/appearance'
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  avatarColorIndex,
  avatarEmojiIndex,
  avatarStyle,
  avatarValue
} from './utils/avatar'
import AvatarGlyph from './components/AvatarGlyph.vue'
import AvatarMark from './components/AvatarMark.vue'
import PantryBrandLogo from './components/PantryBrandLogo.vue'
import PantryIcon from './components/PantryIcon.vue'
import WindowControls from './components/WindowControls.vue'
import WindowDragStrip from './components/WindowDragStrip.vue'

// 设置独立小窗（ui-design §8）：按 7 组承载本地设置（决议 #150 重组，端口归网络、发送键归聊天、去掉杂物抽屉）。

type Section =
  | 'profile'
  | 'general'
  | 'notify'
  | 'storage'
  | 'network'
  | 'shortcuts'
  | 'about'

const sections: Array<{ id: Section; label: string; summary: string }> = [
  { id: 'profile', label: '账号资料', summary: '昵称、头像等会展示在通讯录和聊天窗口。' },
  { id: 'general', label: '通用', summary: '启动方式、窗口行为与外观主题。' },
  { id: 'notify', label: '通知', summary: '新消息的桌面提醒与提示音。' },
  { id: 'storage', label: '聊天与文件', summary: '文件保存、发送键、聊天记录导出与传输记录。' },
  { id: 'network', label: '网络', summary: '手动节点、网段扫描与端口。' },
  { id: 'shortcuts', label: '快捷键', summary: '截图与主窗口的全局快捷键。' },
  { id: 'about', label: '关于', summary: '版本、许可与纯内网安全说明。' }
]

const section = ref<Section>('profile')
const settings = ref<SettingsView | null>(null)
const info = ref<AppInfo | null>(null)
// 关于页「更多信息」折叠（决议 #90）：默认收起开发者向运行时信息
const showAboutDetails = ref(false)

// 我的资料表单
const nick = ref('')
const company = ref('')
const dept = ref('')
const team = ref('')
const avatar = ref(-1)
const fileDir = ref('')
// 网络表单
const newPeer = ref('')
const newCidr = ref('')
const scanTip = ref('')
const confirmingCidr = ref<string | null>(null)
const transfers = ref<TransferView[]>([])
const conversations = ref<ConversationView[]>([])
const exportConvId = ref('')
const exportFrom = ref('')
const exportTo = ref('')
// 高级表单
const udpPortInput = ref('')
const tcpPortInput = ref('')
// 快捷键表单
const captureShortcut = ref('')
const showHideShortcut = ref('')
let stopSettings: (() => void) | null = null
const selectedAvatarEmoji = computed(() => avatarEmojiIndex(avatar.value))
const selectedAvatarColor = computed(() => avatarColorIndex(avatar.value, nick.value || '茶'))
const avatarSummary = computed(() => {
  const colorName = AVATAR_COLORS[selectedAvatarColor.value]?.name ?? ''
  return avatar.value === -1 ? `昵称首字 · ${colorName}` : `图标 · ${colorName}`
})
const currentSection = computed(() => sections.find((item) => item.id === section.value) ?? sections[0])
const activeNotice = computed(() => (section.value === 'network' ? scanTip.value : ''))
const hasManualPeers = computed(() => (settings.value?.manualPeers.length ?? 0) > 0)
const hasScanRanges = computed(() => (settings.value?.scanRangeItems.length ?? 0) > 0)
const hasTransfers = computed(() => transfers.value.length > 0)

onMounted(async () => {
  info.value = await window.pantry.getAppInfo()
  await reload()
  stopSettings = window.pantry.onSettingsUpdated((s) => {
    syncForm(s)
  })
})

onUnmounted(() => {
  stopSettings?.()
  if (toastTimer) clearTimeout(toastTimer)
})

async function reload(): Promise<void> {
  const s = await window.pantry.getSettings()
  syncForm(s)
  conversations.value = await window.pantry.listConversations()
  transfers.value = await window.pantry.listTransfers(30)
}

function syncForm(s: SettingsView): void {
  settings.value = s
  nick.value = s.nick
  company.value = s.company
  dept.value = s.dept
  team.value = s.team
  avatar.value = s.avatar
  fileDir.value = s.fileDir
  udpPortInput.value = String(s.udpPort)
  tcpPortInput.value = String(s.tcpPort)
  captureShortcut.value = s.captureShortcut
  showHideShortcut.value = s.showHideShortcut
  applyAppearance(s)
}

// 「设置已保存」浮层 toast（决议 #151）：失焦 / 调整即时保存后，底部居中胶囊淡入，停留约 1.8s 后淡出
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function flashSaved(text = '设置已保存'): void {
  toast.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1800)
}

// 关于页源码链接（决议 #90）：交系统浏览器打开，非 app 内加载远程内容，不违反纯内网红线
async function openUrl(url: string): Promise<void> {
  await window.pantry.openUrl(url)
}

async function saveApp(patch: AppSettingsPatch, tip = '已保存'): Promise<void> {
  const next = await window.pantry.saveAppSettings(patch)
  syncForm(next)
  flashSaved(tip)
}

function profileDirty(): boolean {
  const s = settings.value
  if (!s) return false
  return (
    nick.value.trim() !== s.nick ||
    company.value.trim() !== s.company ||
    dept.value.trim() !== s.dept ||
    team.value.trim() !== s.team ||
    avatar.value !== s.avatar ||
    fileDir.value !== s.fileDir
  )
}

// 资料失焦 / 头像点击 / 改目录后即时保存（决议 #151）：昵称必填，空则复原并提示；无改动则跳过、不弹窗
async function autoSaveProfile(): Promise<void> {
  if (!nick.value.trim()) {
    if (settings.value) nick.value = settings.value.nick
    flashSaved('昵称不能为空')
    return
  }
  if (!profileDirty()) return
  settings.value = await window.pantry.saveProfile({
    nick: nick.value.trim(),
    company: company.value.trim(),
    dept: dept.value.trim(),
    team: team.value.trim(),
    avatar: avatar.value,
    fileDir: fileDir.value
  })
  if (settings.value) syncForm(settings.value)
  flashSaved('设置已保存')
}

function chooseInitialAvatar(): void {
  avatar.value = -1
  void autoSaveProfile()
}

function chooseAvatarEmoji(index: number): void {
  avatar.value = avatarValue(index, selectedAvatarColor.value)
  void autoSaveProfile()
}

function chooseAvatarColor(index: number): void {
  const emoji = selectedAvatarEmoji.value >= 0 ? selectedAvatarEmoji.value : 0
  avatar.value = avatarValue(emoji, index)
  void autoSaveProfile()
}

function avatarOptionStyle(index: number): { backgroundColor: string; color: string } {
  return avatarStyle(avatarValue(index, selectedAvatarColor.value), nick.value || '茶')
}

async function pickFileDir(): Promise<void> {
  const dir = await window.pantry.pickDirectory()
  if (dir) {
    fileDir.value = dir
    await autoSaveProfile()
  }
}

async function toggleNotifications(): Promise<void> {
  if (!settings.value) return
  await saveApp({
    notifications: !settings.value.notifications
  })
}

async function toggleHideOnCapture(): Promise<void> {
  if (!settings.value) return
  await saveApp({
    hideOnCapture: !settings.value.hideOnCapture
  })
}

async function toggleAutoLaunch(): Promise<void> {
  if (!settings.value) return
  await saveApp({ autoLaunch: !settings.value.autoLaunch })
}

async function toggleCloseToTray(): Promise<void> {
  if (!settings.value) return
  await saveApp({ closeToTray: !settings.value.closeToTray })
}

async function toggleMessagePreview(): Promise<void> {
  if (!settings.value) return
  await saveApp({ showMessagePreview: !settings.value.showMessagePreview })
}

async function changeFontScale(event: Event): Promise<void> {
  const value = Number((event.target as HTMLSelectElement).value)
  if (value === 100 || value === 110 || value === 125) await saveApp({ fontScale: value })
}

async function changeSound(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'none' || value === 'drop' || value === 'wood' || value === 'ding') {
    await saveApp({ sound: value })
  }
}

async function resetAppSettings(): Promise<void> {
  await saveApp(
    {
      notifications: true,
      manualPeers: [],
      scanRanges: [],
      udpPort: DEFAULT_UDP_PORT,
      tcpPort: DEFAULT_TCP_PORT,
      hideOnCapture: true,
      autoLaunch: true,
      closeToTray: true,
      theme: 'light',
      fontScale: 100,
      showMessagePreview: true,
      sound: 'none',
      sendKey: 'enter',
      captureShortcut: DEFAULT_CAPTURE_SHORTCUT,
      showHideShortcut: DEFAULT_SHOWHIDE_SHORTCUT
    },
    '应用设置已重置'
  )
}

async function saveShortcuts(): Promise<void> {
  await saveApp(
    {
      captureShortcut: captureShortcut.value.trim(),
      showHideShortcut: showHideShortcut.value.trim()
    },
    '快捷键已保存'
  )
}

// 快捷键录制框失焦即保存（决议 #151）：清录制态，组合键有变才写入
async function onShortcutBlur(): Promise<void> {
  recordingShortcut.value = null
  const s = settings.value
  if (!s) return
  if (
    captureShortcut.value.trim() === s.captureShortcut &&
    showHideShortcut.value.trim() === s.showHideShortcut
  ) {
    return
  }
  await saveShortcuts()
}

async function resetShortcuts(): Promise<void> {
  captureShortcut.value = DEFAULT_CAPTURE_SHORTCUT
  showHideShortcut.value = DEFAULT_SHOWHIDE_SHORTCUT
  await saveApp(
    {
      captureShortcut: DEFAULT_CAPTURE_SHORTCUT,
      showHideShortcut: DEFAULT_SHOWHIDE_SHORTCUT
    },
    '已恢复默认快捷键'
  )
}

// ---- 录制式快捷键输入（决议 #57）：聚焦后直接按组合键，Esc/退格清空 = 禁用 ----

const recordingShortcut = ref<'capture' | 'showHide' | null>(null)

/** e.code → Electron accelerator 主键名；仅收常用且 normalizeShortcut 白名单内的键 */
function mainKeyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const map: Record<string, string> = {
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: '-'
  }
  return map[code] ?? null
}

function onShortcutKeydown(event: KeyboardEvent, target: 'capture' | 'showHide'): void {
  event.preventDefault()
  event.stopPropagation()
  const model = target === 'capture' ? captureShortcut : showHideShortcut
  if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') {
    model.value = ''
    return
  }
  const mods: string[] = []
  if (event.ctrlKey || event.metaKey) mods.push('CommandOrControl')
  if (event.altKey) mods.push('Alt')
  if (event.shiftKey) mods.push('Shift')
  const key = mainKeyOf(event.code)
  // 全局快捷键必须带修饰键，避免吞掉普通按键
  if (!key || mods.length === 0) return
  model.value = [...mods, key].join('+')
}

/** accelerator → 给用户看的组合（存储仍是 accelerator 原文） */
function shortcutLabel(acc: string): string {
  if (!acc.trim()) return ''
  const mod = info.value?.platform === 'darwin' ? '⌘' : 'Ctrl'
  return acc.replace('CommandOrControl', mod).replace(/\+/g, ' + ')
}

// 端口框失焦即保存（决议 #151）：无改动跳过；无效值复原并提示
async function autoSavePorts(): Promise<void> {
  const s = settings.value
  if (!s) return
  if (udpPortInput.value === String(s.udpPort) && tcpPortInput.value === String(s.tcpPort)) return
  const udpPort = parsePort(udpPortInput.value)
  const tcpPort = parsePort(tcpPortInput.value)
  if (!udpPort || !tcpPort) {
    udpPortInput.value = String(s.udpPort)
    tcpPortInput.value = String(s.tcpPort)
    flashSaved('端口需为 1-65535')
    return
  }
  await saveApp({ udpPort, tcpPort }, '端口已保存，重启后生效')
}

function parsePort(value: string): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

async function exportData(format: 'backup' | 'html' | 'txt'): Promise<void> {
  const path = await window.pantry.exportData(format, exportOptions())
  flashSaved(path ? '已导出' : '导出已取消')
}

function exportOptions(): DataExportOptions | undefined {
  const out: DataExportOptions = {}
  if (exportConvId.value) out.convId = exportConvId.value
  const from = dateStart(exportFrom.value)
  const to = dateEnd(exportTo.value)
  if (from !== null) out.fromTs = from
  if (to !== null) out.toTs = to
  return Object.keys(out).length > 0 ? out : undefined
}

function dateStart(value: string): number | null {
  if (!value) return null
  const ts = new Date(`${value}T00:00:00`).getTime()
  return Number.isFinite(ts) ? ts : null
}

function dateEnd(value: string): number | null {
  if (!value) return null
  const ts = new Date(`${value}T23:59:59.999`).getTime()
  return Number.isFinite(ts) ? ts : null
}

function convLabel(conv: ConversationView): string {
  const prefix = conv.type === 'group' ? '讨论组' : '单聊'
  return `${prefix} ${conv.peerId}${conv.preview ? ` · ${conv.preview.slice(0, 18)}` : ''}`
}

async function importData(): Promise<void> {
  const result = await window.pantry.importData()
  flashSaved(result ? `已导入 ${result.imported} 条，跳过 ${result.skipped} 条` : '导入已取消')
}

async function revealTransfer(transferId: string): Promise<void> {
  await window.pantry.revealTransfer(transferId)
}

function transferStatusLabel(status: TransferView['status']): string {
  const map: Record<TransferView['status'], string> = {
    offering: '等待',
    accepted: '传输中',
    done: '完成',
    declined: '已拒收',
    canceled: '已取消',
    failed: '失败'
  }
  return map[status]
}

function transferMeta(view: TransferView): string {
  const size = formatBytes(view.totalSize)
  const done = formatBytes(view.bytesDone)
  return view.status === 'accepted' ? `${done} / ${size}` : size
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function scanRangeSourceLabel(item: ScanRangeItemView): string {
  if (item.source === 'self') return '本机'
  const name = item.sourceName?.trim() || '同事'
  return `来自 ${name}`
}

async function addPeer(): Promise<void> {
  const addr = newPeer.value.trim()
  if (!addr) return
  const ok = await window.pantry.addManualPeer(addr)
  if (ok) {
    newPeer.value = ''
    await reload()
    flashSaved('已添加并探测')
  } else {
    flashSaved('地址格式不对（ip 或 ip:端口）')
  }
}

async function removePeer(addr: string): Promise<void> {
  if (!settings.value) return
  await saveApp({
    manualPeers: settings.value.manualPeers.filter((p) => p !== addr)
  })
}

async function addRange(): Promise<void> {
  const cidr = newCidr.value.trim()
  if (!cidr || !settings.value) return
  const count = await window.pantry.scanRange(cidr)
  if (count < 0) {
    scanTip.value = '网段不合法（如 10.1.2.0/24，最大 /22）'
    return
  }
  scanTip.value = `已向 ${count} 个地址发出探测，在线的会出现在通讯录`
  if (!settings.value.scanRanges.includes(cidr)) {
    await saveApp({
      scanRanges: [...settings.value.scanRanges, cidr]
    })
  }
  newCidr.value = ''
}

async function rescan(cidr: string): Promise<void> {
  const count = await window.pantry.scanRange(cidr)
  scanTip.value =
    count >= 0 ? `已向 ${count} 个地址发出探测，新上线的同事稍后计入在线数` : '网段不合法'
  // 探测/应答异步滞后，延迟重拉设置以更新在线数（决议 #160）
  if (count >= 0) setTimeout(() => void reload(), 2500)
}

async function removeRange(cidr: string): Promise<void> {
  if (!settings.value) return
  await saveApp({
    scanRanges: settings.value.scanRanges.filter((r) => r !== cidr)
  })
}

// 删除二次确认（决议 #160）：点 ✕ 进确认态，点「删除」才真正移除
async function confirmRemove(cidr: string): Promise<void> {
  confirmingCidr.value = null
  await removeRange(cidr)
}
</script>

<template>
  <div class="settings">
    <!-- 沉浸式无标题栏（决议 #49/#52）：顶部拖拽带；设置窗 Win/Linux 仅自绘关闭按钮 -->
    <WindowDragStrip />
    <WindowControls buttons="close" />
    <aside class="sidebar">
      <div class="account-card">
        <AvatarMark class="account-avatar" :avatar="avatar" :name="nick || '茶'" />
        <div class="account-copy">
          <strong>{{ nick || '未命名' }}</strong>
          <span>{{ company || '未填写公司' }}</span>
        </div>
      </div>

      <nav class="nav" aria-label="设置分组">
        <button
          v-for="item in sections"
          :key="item.id"
          :class="{ on: section === item.id }"
          @click="section = item.id"
        >
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <main class="body">
      <header class="page-head">
        <div>
          <h1>{{ currentSection.label }}</h1>
          <p>{{ currentSection.summary }}</p>
        </div>
        <span v-if="activeNotice" class="notice">{{ activeNotice }}</span>
      </header>

      <div v-if="!settings" class="empty-panel">正在读取设置...</div>

      <template v-else>
        <section v-if="section === 'profile'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>个人身份</h2>
              <p>昵称必填。公司、部门、团队会用于通讯录树形分组。</p>
            </div>
            <!-- 头像编辑器（决议 #50）：大预览 + 样式分段切换 + 图标网格 + 背景色板 -->
            <div class="avatar-editor">
              <div class="avatar-stage">
                <AvatarMark class="avatar-preview" :avatar="avatar" :name="nick || '茶'" />
                <span class="avatar-current">{{ avatarSummary }}</span>
              </div>
              <div class="avatar-mode-block">
                <div class="avatar-mode" role="radiogroup" aria-label="头像样式">
                  <button
                    type="button"
                    :class="{ on: avatar >= 0 }"
                    @click="chooseAvatarEmoji(selectedAvatarEmoji >= 0 ? selectedAvatarEmoji : 0)"
                  >
                    图标头像
                  </button>
                  <button type="button" :class="{ on: avatar === -1 }" @click="chooseInitialAvatar">
                    昵称首字
                  </button>
                </div>
                <p class="avatar-mode-hint">
                  {{
                    avatar === -1
                      ? '使用昵称第一个字作头像，背景色按昵称自动分配。'
                      : '从下方挑一个图标，再配一个背景色。'
                  }}
                </p>
              </div>
              <div class="avatar-pick">
                <span class="avatar-label">图标</span>
                <div class="avatar-grid" aria-label="精选头像图标">
                  <button
                    v-for="(_, idx) in AVATAR_EMOJIS"
                    :key="idx"
                    type="button"
                    class="avatar-choice"
                    :class="{ on: selectedAvatarEmoji === idx }"
                    :style="avatarOptionStyle(idx)"
                    :aria-label="`头像图标 ${idx + 1}`"
                    @click="chooseAvatarEmoji(idx)"
                  >
                    <AvatarGlyph :index="idx" />
                  </button>
                </div>
                <span class="avatar-label">背景色</span>
                <div class="avatar-colors" aria-label="头像背景色">
                  <button
                    v-for="(color, idx) in AVATAR_COLORS"
                    :key="color.name"
                    type="button"
                    class="color-choice"
                    :class="{ on: selectedAvatarColor === idx && avatar >= 0 }"
                    :style="{ backgroundColor: color.bg }"
                    :title="color.name"
                    :aria-label="`头像背景色：${color.name}`"
                    @click="chooseAvatarColor(idx)"
                  ></button>
                </div>
              </div>
            </div>
            <div class="field-grid">
              <label class="field">
                <span>昵称</span>
                <input v-model="nick" maxlength="32" @blur="autoSaveProfile" />
              </label>
              <label class="field">
                <span>公司</span>
                <input v-model="company" maxlength="32" @blur="autoSaveProfile" />
              </label>
              <label class="field">
                <span>部门</span>
                <input v-model="dept" maxlength="32" @blur="autoSaveProfile" />
              </label>
              <label class="field">
                <span>团队</span>
                <input v-model="team" maxlength="32" @blur="autoSaveProfile" />
              </label>
            </div>
          </div>
        </section>

        <section v-else-if="section === 'general'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>启动与窗口</h2>
              <p>办公内网常驻使用，默认保持后台在线。</p>
            </div>
            <div class="setting-line">
              <div>
                <strong>开机自启</strong>
                <small>登录系统后自动启动茶话间。</small>
              </div>
              <label class="switch">
                <input type="checkbox" :checked="settings.autoLaunch" @change="toggleAutoLaunch" />
                <span></span>
              </label>
            </div>
            <div class="setting-line">
              <div>
                <strong>关闭到托盘</strong>
                <small>点关闭按钮时保持在线，仍可接收消息。</small>
              </div>
              <label class="switch">
                <input type="checkbox" :checked="settings.closeToTray" @change="toggleCloseToTray" />
                <span></span>
              </label>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>外观</h2>
              <p>主题和字体缩放会同步到主窗口，调整后立即生效。</p>
            </div>
            <div class="setting-line">
              <div>
                <strong>主题</strong>
                <small>深色主题适合弱光环境。</small>
              </div>
              <div class="segmented" role="group" aria-label="主题">
                <button type="button" :class="{ on: settings.theme === 'light' }" @click="saveApp({ theme: 'light' })">
                  浅色
                </button>
                <button type="button" :class="{ on: settings.theme === 'dark' }" @click="saveApp({ theme: 'dark' })">
                  深色
                </button>
              </div>
            </div>
            <label class="setting-line">
              <div>
                <strong>字体缩放</strong>
                <small>适配投屏、远距离办公和高分屏。</small>
              </div>
              <select :value="settings.fontScale" @change="changeFontScale">
                <option :value="100">100%</option>
                <option :value="110">110%</option>
                <option :value="125">125%</option>
              </select>
            </label>
            <div class="panel-actions">
              <button class="ghost" @click="resetAppSettings">重置应用设置</button>
            </div>
          </div>
        </section>

        <section v-else-if="section === 'notify'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>提醒</h2>
              <p>通知开关只影响桌面提醒，不影响消息接收。</p>
            </div>
            <div class="setting-line">
              <div>
                <strong>系统通知</strong>
                <small>新消息到达时显示系统通知。</small>
              </div>
              <label class="switch">
                <input type="checkbox" :checked="settings.notifications" @change="toggleNotifications" />
                <span></span>
              </label>
            </div>
            <div class="setting-line">
              <div>
                <strong>通知内容预览</strong>
                <small>关闭后通知只显示会话名称。</small>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="settings.showMessagePreview"
                  @change="toggleMessagePreview"
                />
                <span></span>
              </label>
            </div>
            <label class="setting-line">
              <div>
                <strong>提示音</strong>
                <small>默认关闭，减少办公环境打扰。</small>
              </div>
              <select :value="settings.sound" @change="changeSound">
                <option value="none">关闭</option>
                <option value="drop">水滴</option>
                <option value="wood">木鱼</option>
                <option value="ding">叮咚</option>
              </select>
            </label>
          </div>
        </section>

        <section v-else-if="section === 'storage'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>文件接收</h2>
              <p>文件保存目录用于普通文件、图片缓存和迁移导入恢复。</p>
            </div>
            <div class="setting-line">
              <div>
                <strong>保存位置</strong>
                <small class="path">{{ fileDir || settings.defaultFileDir }}</small>
              </div>
              <button class="ghost" @click="pickFileDir">更改</button>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>发送</h2>
              <p>发送键影响所有单聊和讨论组输入框，调整后立即生效。</p>
            </div>
            <div class="setting-line">
              <div>
                <strong>发送键</strong>
                <small>另一组组合键用于换行。</small>
              </div>
              <div class="segmented" role="group" aria-label="发送键">
                <button type="button" :class="{ on: settings.sendKey === 'enter' }" @click="saveApp({ sendKey: 'enter' })">
                  Enter
                </button>
                <button type="button" :class="{ on: settings.sendKey === 'ctrlEnter' }" @click="saveApp({ sendKey: 'ctrlEnter' })">
                  Ctrl/Cmd+Enter
                </button>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>聊天记录</h2>
              <p>导出阅读格式或迁移备份包；导入时会按消息 ID 去重。</p>
            </div>
            <label class="field">
              <span>导出会话</span>
              <select v-model="exportConvId">
                <option value="">全部会话</option>
                <option v-for="conv in conversations" :key="conv.id" :value="conv.id">
                  {{ convLabel(conv) }}
                </option>
              </select>
            </label>
            <div class="field">
              <span>时间范围</span>
              <div class="date-range">
                <input v-model="exportFrom" type="date" />
                <span>至</span>
                <input v-model="exportTo" type="date" />
              </div>
            </div>
            <div class="button-row export-actions">
              <button class="ghost" @click="exportData('backup')">备份包</button>
              <button class="ghost" @click="exportData('html')">HTML</button>
              <button class="ghost" @click="exportData('txt')">TXT</button>
              <button class="primary subtle" @click="importData">导入</button>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>传输记录</h2>
              <p>显示最近 30 条文件传输。</p>
            </div>
            <div v-if="!hasTransfers" class="empty-state">暂无传输记录</div>
            <ul v-else class="transfer-list">
              <li v-for="t in transfers" :key="t.transferId">
                <div>
                  <strong>{{ t.name }}</strong>
                  <small>{{ transferStatusLabel(t.status) }} · {{ transferMeta(t) }}</small>
                </div>
                <button class="ghost compact" :disabled="!t.savedPath" @click="revealTransfer(t.transferId)">
                  打开
                </button>
              </li>
            </ul>
          </div>
        </section>

        <section v-else-if="section === 'network'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>手动节点</h2>
              <p>跨网段发现失败时，可手动添加对方 IP 或 IP:端口。</p>
            </div>
            <div class="inline-form">
              <input
                v-model="newPeer"
                placeholder="如 10.2.0.8 或 10.2.0.8:17878"
                @keydown.enter="addPeer"
              />
              <button class="primary" @click="addPeer">添加</button>
            </div>
            <div v-if="!hasManualPeers" class="empty-state">尚未添加手动节点</div>
            <ul v-else class="chips">
              <li v-for="p in settings.manualPeers" :key="p">
                <span>{{ p }}</span>
                <button class="icon-button" title="移除" @click="removePeer(p)">
                  <PantryIcon name="x" :size="13" />
                </button>
              </li>
            </ul>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>网段扫描</h2>
              <p>用于发现同内网不同网段的同事，最大支持 /22。</p>
            </div>
            <div class="inline-form">
              <input
                v-model="newCidr"
                placeholder="如 10.1.2.0/24"
                @keydown.enter="addRange"
              />
              <button class="primary" @click="addRange">扫描</button>
            </div>
            <div v-if="!hasScanRanges" class="empty-state">尚未保存扫描网段</div>
            <div v-else class="range-table">
              <div class="range-row range-head">
                <span>网段</span>
                <span>在线</span>
                <span>操作</span>
              </div>
              <div v-for="r in settings.scanRangeItems" :key="r.cidr" class="range-row">
                <div class="range-cidr">
                  <span class="cidr-text">{{ r.cidr }}</span>
                  <span class="cidr-source">（{{ scanRangeSourceLabel(r) }}）</span>
                </div>
                <span class="range-count">
                  <span class="count-badge" :class="{ zero: r.nodeCount === 0 }">{{ r.nodeCount }}</span>
                </span>
                <span class="range-ops">
                  <button class="icon-button accent" title="刷新该网段（重新探测）" @click="rescan(r.cidr)">
                    <PantryIcon name="refresh" :size="14" />
                  </button>
                  <button class="icon-button danger" title="删除该网段" @click="confirmingCidr = r.cidr">
                    <PantryIcon name="x" :size="14" />
                  </button>
                </span>
                <div v-if="confirmingCidr === r.cidr" class="range-confirm">
                  <span class="confirm-q">删除该网段？</span>
                  <button class="confirm-del" @click="confirmRemove(r.cidr)">删除</button>
                  <button class="confirm-cancel" @click="confirmingCidr = null">取消</button>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>端口</h2>
              <p>全员端口需一致，修改后重启应用生效。</p>
            </div>
            <div class="field-grid">
              <label class="field">
                <span>UDP 端口</span>
                <input v-model="udpPortInput" type="number" min="1" max="65535" @blur="autoSavePorts" />
              </label>
              <label class="field">
                <span>TCP 端口</span>
                <input v-model="tcpPortInput" type="number" min="1" max="65535" @blur="autoSavePorts" />
              </label>
            </div>
          </div>
        </section>

        <section v-else-if="section === 'shortcuts'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>全局快捷键</h2>
              <p>点击输入框后直接按下组合键（需包含 Ctrl/Alt 等修饰键）；Esc 或退格清空表示禁用。</p>
            </div>
            <label class="field">
              <span>截图</span>
              <input
                class="shortcut-input"
                :class="{ recording: recordingShortcut === 'capture' }"
                :value="
                  recordingShortcut === 'capture' && !captureShortcut
                    ? ''
                    : shortcutLabel(captureShortcut)
                "
                :placeholder="recordingShortcut === 'capture' ? '按下新组合键…' : '未设置（已禁用）'"
                readonly
                @focus="recordingShortcut = 'capture'"
                @blur="onShortcutBlur"
                @keydown="onShortcutKeydown($event, 'capture')"
              />
              <small v-if="settings.shortcutStatus && !settings.shortcutStatus.capture" class="shortcut-warn">
                注册失败：组合键可能已被系统或其他程序占用（如 UOS 系统截图），请换一个组合后保存。
              </small>
            </label>
            <label class="field">
              <span>显示/隐藏主窗</span>
              <input
                class="shortcut-input"
                :class="{ recording: recordingShortcut === 'showHide' }"
                :value="
                  recordingShortcut === 'showHide' && !showHideShortcut
                    ? ''
                    : shortcutLabel(showHideShortcut)
                "
                :placeholder="recordingShortcut === 'showHide' ? '按下新组合键…' : '未设置（已禁用）'"
                readonly
                @focus="recordingShortcut = 'showHide'"
                @blur="onShortcutBlur"
                @keydown="onShortcutKeydown($event, 'showHide')"
              />
              <small v-if="settings.shortcutStatus && !settings.shortcutStatus.showHide" class="shortcut-warn">
                注册失败：组合键可能已被系统或其他程序占用，请换一个组合后保存。
              </small>
            </label>
            <div class="setting-line">
              <div>
                <strong>截图时隐藏窗口</strong>
                <small>避免把茶话间主窗口截进去。</small>
              </div>
              <label class="switch">
                <input type="checkbox" :checked="settings.hideOnCapture" @change="toggleHideOnCapture" />
                <span></span>
              </label>
            </div>
            <div class="panel-actions">
              <button class="ghost" @click="resetShortcuts">恢复默认</button>
            </div>
          </div>
        </section>

        <section v-else class="page-section">
          <div class="about-panel">
            <!-- 品牌标识区（决议 #90 重设计）：居中圆标 + 中英文名 + 定位 + 纯内网信任徽条 -->
            <div class="about-hero">
              <PantryBrandLogo variant="color" :size="60" class="about-logo" />
              <h2>茶话间<span class="about-latin">Teahouse</span></h2>
              <p class="about-tagline">纯内网即时通讯与文件传输</p>
              <div class="about-trust">
                <PantryIcon name="shield" :size="13" />
                <span>无服务器 · 无遥测 · 数据不出局域网</span>
              </div>
            </div>

            <!-- 默认只露版本 / 许可 / 源码（决议 #90）：面向普通用户的核心信息 -->
            <dl class="about-rows">
              <div class="about-row">
                <dt>版本</dt>
                <dd class="mono">{{ info?.version ?? '-' }}</dd>
              </div>
              <div class="about-row">
                <dt>许可</dt>
                <dd>MIT 许可证</dd>
              </div>
              <div class="about-row">
                <dt>源码</dt>
                <dd>
                  <a class="about-link" @click="openUrl('https://github.com/skyjt/teahouse')">
                    github.com/skyjt/teahouse
                    <PantryIcon name="external" :size="13" />
                  </a>
                </dd>
              </div>
            </dl>

            <!-- 开发者向运行时信息收进折叠区（决议 #90）：就地展开，Chrome 108 无原生 popover -->
            <button
              class="about-more"
              :aria-expanded="showAboutDetails"
              @click="showAboutDetails = !showAboutDetails"
            >
              <span>{{ showAboutDetails ? '收起详细信息' : '更多信息' }}</span>
              <PantryIcon :name="showAboutDetails ? 'chevron-up' : 'chevron-down'" :size="15" />
            </button>

            <dl v-if="showAboutDetails" class="about-rows about-detail">
              <div class="about-row">
                <dt>Electron</dt>
                <dd class="mono">{{ info?.electron ?? '-' }}</dd>
              </div>
              <div class="about-row">
                <dt>Chromium</dt>
                <dd class="mono">{{ info?.chrome ?? '-' }}</dd>
              </div>
              <div class="about-row">
                <dt>Node</dt>
                <dd class="mono">{{ info?.node ?? '-' }}</dd>
              </div>
              <div class="about-row">
                <dt>本机节点</dt>
                <dd class="mono nodeid">{{ info?.nodeId ?? '-' }}</dd>
              </div>
              <div class="about-row">
                <dt>Emoji 图形</dt>
                <dd class="muted">Twemoji（本地打包 · CC-BY 4.0）</dd>
              </div>
            </dl>
          </div>
        </section>
      </template>
    </main>
    <Transition name="toast">
      <div v-if="toast" class="toast" role="status" aria-live="polite">
        <PantryIcon name="check" :size="15" />
        <span>{{ toast }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.settings {
  /* 设置页专属标尺（决议 #150）：间距 4px 基准台阶 / 圆角 Shape Lock（容器 8 · 控件 6 · 胶囊 999）/
     字号 4 级阶梯，收敛全页魔数、统一节奏；仅设置页作用域，不影响聊天等其他界面 */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --r-card: 8px;
  --r-control: 6px;
  --r-pill: 999px;
  --fs-title: 18px;
  --fs-section: 15px;
  --fs-body: 13px;
  --fs-aux: 12px;
  display: flex;
  height: 100vh;
  min-width: 620px;
  background: var(--bg-list);
  color: var(--text-1);
}

.sidebar {
  width: 174px;
  flex: 0 0 174px;
  border-right: 1px solid var(--line);
  background: var(--bg-window);
  padding: 38px 10px 14px; /* 顶部让出拖拽带与 mac 红绿灯 */
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.account-card {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-3);
  border-radius: var(--r-card);
  background: var(--bg-list);
}

.account-avatar {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.account-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-copy strong,
.account-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-copy strong {
  font-size: var(--fs-body);
  line-height: 1.4;
}

.account-copy span {
  color: var(--text-3);
  font-size: var(--fs-aux);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav button {
  height: 34px;
  border: none;
  border-radius: var(--r-control);
  background: transparent;
  color: var(--text-2);
  font-size: var(--fs-body);
  text-align: left;
  padding: 0 var(--sp-3);
  cursor: pointer;
}

.nav button:hover {
  background: var(--bg-list);
  color: var(--text-1);
}

.nav button.on {
  background: var(--primary-weak);
  color: var(--primary);
  font-weight: 600;
}

.body {
  flex: 1;
  min-width: 0;
  /* 滚动视口从拖拽带下方开始，内容滚动时不会钻进顶部 32px 不可交互区 */
  margin-top: 32px;
  padding: 8px 22px 24px;
  overflow-y: auto;
}

.page-head {
  min-height: 58px;
  display: flex;
  justify-content: space-between;
  gap: var(--sp-4);
  padding-bottom: var(--sp-4);
  margin-bottom: var(--sp-4);
  border-bottom: 1px solid var(--line);
}

.page-head h1 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-title);
  font-weight: 700;
  line-height: 1.25;
}

.page-head p,
.panel-head p {
  color: var(--text-3);
  font-size: var(--fs-aux);
  line-height: 1.5;
}

.notice {
  align-self: flex-start;
  max-width: 190px;
  border-radius: var(--r-control);
  background: var(--primary-weak);
  color: var(--primary);
  font-size: var(--fs-aux);
  line-height: 1.4;
  padding: var(--sp-1) var(--sp-2);
}

.page-section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.panel,
.empty-panel {
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  background: var(--bg-window);
}

.panel {
  padding: var(--sp-4);
}

.panel-head {
  margin-bottom: var(--sp-3);
}

.panel-head h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-section);
  font-weight: 700;
  line-height: 1.35;
}

.setting-line {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-3) 0;
  border-top: 1px solid var(--line);
}

.panel-head + .setting-line {
  border-top: none;
  padding-top: 0;
}

.setting-line > div:first-child {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.setting-line strong,
.transfer-list strong {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}

.setting-line small,
.transfer-list small {
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.4;
}

.setting-line select {
  width: 156px;
  flex: 0 0 auto;
}

.is-disabled {
  opacity: 0.72;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.field span {
  color: var(--text-2);
  font-size: 12px;
}

/* 分段控件（决议 #150）：二选一偏好（主题 / 发送键）即时生效，比下拉直观，与头像样式分段同语言 */
.segmented {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  background: var(--bg-list);
}
.segmented button {
  border: none;
  background: transparent;
  border-radius: calc(var(--r-control) - 2px);
  padding: var(--sp-1) var(--sp-3);
  font-size: var(--fs-body);
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.segmented button:hover {
  color: var(--text-1);
}
.segmented button.on {
  background: var(--bg-window);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2) var(--sp-3);
}

.field-grid .field {
  margin-bottom: 0;
}

.field input,
.field select,
.inline-form input,
.date-range input,
.setting-line select {
  height: 32px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg-window);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
  padding: 0 10px;
  user-select: text;
}

.field input,
.field select,
.date-range input {
  width: 100%;
}

.field input:focus,
.field select:focus,
.inline-form input:focus,
.date-range input:focus,
.setting-line select:focus {
  border-color: var(--primary);
}

.field input:disabled,
.field select:disabled,
.setting-line select:disabled {
  background: var(--bg-list);
  color: var(--text-3);
}

.path {
  overflow-wrap: anywhere;
}

/* 录制式快捷键输入（决议 #57） */
.shortcut-input {
  cursor: pointer;
  caret-color: transparent;
}

.shortcut-input.recording {
  border-color: var(--primary);
  background: var(--primary-weak);
}

.shortcut-warn {
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
}

/* 头像编辑器（决议 #50）：预览与样式切换同行，图标网格与色板全宽分节 */
.avatar-editor {
  display: grid;
  grid-template-columns: 88px 1fr;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.avatar-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 30px;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.08),
    0 4px 14px rgba(0, 0, 0, 0.1);
}

.avatar-current {
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
  white-space: nowrap;
}

.avatar-mode-block {
  min-width: 0;
}

.avatar-pick {
  grid-column: 1 / -1;
  min-width: 0;
}

.avatar-mode {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-list);
  margin-bottom: 8px;
}

.avatar-mode-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);
}

.avatar-mode button {
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  padding: 0 14px;
  cursor: pointer;
}

.avatar-mode button.on {
  background: var(--bg-window);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}

.avatar-label {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 6px;
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(10, 30px);
  gap: 8px;
  margin-bottom: 12px;
}

.avatar-choice {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  font-size: 15px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease;
}

.avatar-choice:hover {
  transform: scale(1.12);
}

.avatar-choice.on {
  border-color: var(--primary);
  box-shadow:
    0 0 0 2px var(--primary),
    inset 0 0 0 1px rgba(255, 255, 255, 0.78);
}

.avatar-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.color-choice {
  position: relative;
  width: 24px;
  height: 24px;
  border: 2px solid var(--bg-window);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--line);
  cursor: pointer;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease;
}

.color-choice:hover {
  transform: scale(1.12);
}

.color-choice.on {
  box-shadow: 0 0 0 2px var(--primary);
}

.color-choice.on::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
}

.switch input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.switch span {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--line);
  transition:
    background 0.16s ease,
    opacity 0.16s ease;
}

.switch span::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-window);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  transition: transform 0.16s ease;
}

.switch input:checked + span {
  background: var(--primary);
}

.switch input:checked + span::after {
  transform: translateX(16px);
}

.switch input:disabled {
  cursor: default;
}

.switch input:disabled + span {
  opacity: 0.55;
}

.button-row,
.panel-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-actions {
  justify-content: flex-end;
  margin-top: 14px;
}

.button-row {
  justify-content: flex-end;
  flex: 0 0 auto;
}

.primary,
.ghost {
  height: 32px;
  border-radius: 6px;
  font-size: 13px;
  padding: 0 14px;
  cursor: pointer;
}

.primary {
  border: none;
  background: var(--primary);
  color: #fff;
}

.primary.subtle {
  background: var(--primary-weak);
  color: var(--primary);
}

.ghost {
  border: 1px solid var(--line);
  background: var(--bg-window);
  color: var(--text-2);
}

.ghost:hover,
.primary.subtle:hover,
.icon-button:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.primary:disabled,
.ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 保存按钮成功态（用户反馈）：保存成功就地变「✓ 保存成功！」+ 确认弹动，3 秒后恢复 */
.save-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}

.save-btn.is-saved {
  box-shadow: 0 0 0 3px var(--primary-weak);
  animation: save-pop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 次要保存按钮（茶青弱底）成功时提升为实心茶青 + 白字，让对勾与文案有足够对比 */
.primary.subtle.save-btn.is-saved {
  background: var(--primary);
  color: #fff;
}

.save-check {
  animation: save-check-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes save-pop {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(1.06);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes save-check-in {
  0% {
    transform: scale(0.2);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .save-btn.is-saved,
  .save-check {
    animation: none;
  }
}

.compact {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.inline-form {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.inline-form input {
  flex: 1;
}

.chips,
.transfer-list {
  list-style: none;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chips li {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg-list);
  color: var(--text-2);
  font-size: 12px;
  padding: 4px 6px 4px 10px;
}

.chips li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-3);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.empty-panel,
.empty-state {
  color: var(--text-3);
  font-size: 12px;
  text-align: center;
}

.empty-panel {
  padding: 28px;
}

.empty-state {
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: var(--bg-list);
  padding: 14px;
}

/* 网段扫描表格（决议 #160）：网段 / 在线节点数 / 操作 三列对齐，贴合设置页标尺 */
.range-table {
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  overflow: hidden;
}

.range-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 72px;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
}

.range-row + .range-row {
  border-top: 1px solid var(--line);
}

.range-head {
  background: var(--bg-list);
  border-bottom: 1px solid var(--line);
}

.range-head > span {
  font-size: var(--fs-aux);
  color: var(--text-3);
}

.range-head > span:nth-child(2) {
  text-align: center;
}

.range-head > span:nth-child(3) {
  text-align: right;
}

.range-cidr {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.cidr-text {
  flex-shrink: 0;
  font-family: var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  font-size: var(--fs-body);
  color: var(--text-1);
  white-space: nowrap;
}

.cidr-source {
  min-width: 0;
  font-size: var(--fs-aux);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.range-count {
  display: flex;
  justify-content: center;
}

.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--primary-weak);
  color: var(--primary);
  font-size: var(--fs-aux);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.count-badge.zero {
  background: var(--bg-list);
  color: var(--text-3);
}

.range-ops {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-1);
}

/* 操作按钮平时即带淡淡意图色（决议 #160）：刷新淡茶青、删除淡红，hover 加深 */
.icon-button.accent {
  color: var(--primary);
  opacity: 0.55;
}

.icon-button.danger {
  color: var(--danger);
  opacity: 0.55;
}

.icon-button.accent:hover,
.icon-button.danger:hover {
  opacity: 1;
}

/* 删除二次确认覆盖层（决议 #160）：盖住该行问「删除该网段？」 */
.range-confirm {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-3);
  background: var(--bg-window);
}

.confirm-q {
  margin-right: auto;
  font-size: var(--fs-aux);
  color: var(--text-1);
}

.confirm-del,
.confirm-cancel {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--fs-aux);
  padding: 4px 10px;
  border-radius: var(--r-control);
}

.confirm-del {
  color: var(--danger);
  font-weight: 600;
}

.confirm-cancel {
  color: var(--text-2);
}

.confirm-del:hover,
.confirm-cancel:hover {
  background: var(--bg-list);
}

.transfer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transfer-list li {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: 6px;
  background: var(--bg-list);
  padding: 9px 10px;
}

.transfer-list li > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.transfer-list strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date-range {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}

.date-range > span {
  color: var(--text-3);
  font-size: 12px;
}

.export-actions {
  justify-content: flex-start;
  margin-top: 4px;
}

.port-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* 关于页（决议 #90 重设计）：单卡片承载——居中品牌标识 + 键值信息行 + 折叠开发者托盘 */
.about-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-window);
  overflow: hidden;
}

.about-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 20px 20px;
  border-bottom: 1px solid var(--line);
}

.about-logo {
  margin-bottom: 14px;
}

.about-hero h2 {
  margin: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-1);
}

.about-latin {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--text-3);
}

.about-tagline {
  margin-top: 6px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.5;
}

.about-trust {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 13px;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--primary-weak);
  color: var(--primary);
  font-size: 12px;
  line-height: 1.4;
}

.about-rows {
  list-style: none;
  padding: 2px 20px;
}

.about-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
}

.about-row + .about-row {
  border-top: 1px solid var(--line);
}

.about-row dt {
  flex: 0 0 auto;
  color: var(--text-3);
  font-size: 13px;
}

.about-row dd {
  min-width: 0;
  text-align: right;
  overflow-wrap: anywhere;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
}

.about-row dd.muted {
  color: var(--text-2);
  font-weight: 500;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-weight: 500;
  letter-spacing: 0.2px;
}

.nodeid {
  font-size: 12px;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.about-link:hover {
  text-decoration: underline;
}

.about-more {
  width: 100%;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.about-more:hover {
  color: var(--primary);
  background: var(--primary-weak);
}

.about-detail {
  border-top: 1px solid var(--line);
  background: var(--bg-list);
  animation: about-reveal 0.18s ease;
}

@keyframes about-reveal {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .about-detail {
    animation: none;
  }
}

@media (max-width: 660px) {
  .settings {
    min-width: 0;
  }

  .sidebar {
    width: 150px;
    flex-basis: 150px;
  }

  .body {
    padding: 16px;
  }

  .field-grid,
  .port-grid {
    grid-template-columns: 1fr;
  }
}

/* 「设置已保存」浮层 toast（决议 #152）：修复上一版样式丢失（裸 div 挤进 flex 布局乱放）+ taste 重设计。
   固定在右侧内容区水平居中（calc 补偿 174px 侧栏，不偏向侧栏）、底部上浮（顶部被拖拽带 / 标题 / 关闭按钮占满）；
   深色胶囊对比当前主题、currentColor 对勾保证两主题对比、茶青味柔影（非纯黑）；淡入 + 上移 / 淡出 + 下移，尊重 reduced-motion */
.toast {
  position: fixed;
  left: calc(50% + 87px);
  bottom: 22px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 9px var(--sp-4);
  border-radius: var(--r-pill);
  background: var(--text-1);
  color: var(--bg-window);
  font-size: var(--fs-body);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 8px 26px rgba(34, 49, 42, 0.3), 0 2px 6px rgba(34, 49, 42, 0.18);
  z-index: 60;
  pointer-events: none;
}
.toast .pantry-icon {
  flex: none;
}
.toast-enter-active {
  transition: opacity 0.24s ease, transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity 0.16s ease;
  }
  .toast-enter-from,
  .toast-leave-to {
    transform: translateX(-50%);
  }
}
</style>
