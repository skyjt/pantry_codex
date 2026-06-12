<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  AppInfo,
  AppSettingsPatch,
  ConversationView,
  DataExportOptions,
  SettingsView,
  TransferView
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
import PantryIcon from './components/PantryIcon.vue'

// 设置独立小窗（ui-design §8）：P1 起按 8 组完整承载本地设置。

type Section =
  | 'profile'
  | 'general'
  | 'notify'
  | 'storage'
  | 'network'
  | 'shortcuts'
  | 'advanced'
  | 'about'

const sections: Array<{ id: Section; label: string; summary: string }> = [
  { id: 'profile', label: '账号资料', summary: '这些信息会展示在局域网通讯录和聊天窗口。' },
  { id: 'general', label: '通用外观', summary: '控制启动、窗口、主题和基础显示。' },
  { id: 'notify', label: '消息通知', summary: '调整提醒方式、隐私预览和发送习惯。' },
  { id: 'storage', label: '聊天与文件', summary: '管理文件保存位置、聊天记录导出和传输记录。' },
  { id: 'network', label: '网络连接', summary: '用于跨网段发现、手动节点和局域网扫描。' },
  { id: 'shortcuts', label: '快捷键', summary: '配置截图和主窗口唤起快捷键。' },
  { id: 'advanced', label: '安全与高级', summary: '端口、网卡、诊断与维护能力集中在这里。' },
  { id: 'about', label: '关于', summary: '查看版本、运行时和纯内网安全边界。' }
]

const section = ref<Section>('profile')
const settings = ref<SettingsView | null>(null)
const info = ref<AppInfo | null>(null)
const savedTip = ref('')

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
const currentSection = computed(() => sections.find((item) => item.id === section.value) ?? sections[0])
const activeNotice = computed(() =>
  section.value === 'network' && scanTip.value ? scanTip.value : savedTip.value
)
const hasManualPeers = computed(() => (settings.value?.manualPeers.length ?? 0) > 0)
const hasScanRanges = computed(() => (settings.value?.scanRanges.length ?? 0) > 0)
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

function flashSaved(text = '已保存'): void {
  savedTip.value = text
  setTimeout(() => (savedTip.value = ''), 1500)
}

async function saveApp(patch: AppSettingsPatch, tip = '已保存'): Promise<void> {
  const next = await window.pantry.saveAppSettings(patch)
  syncForm(next)
  flashSaved(tip)
}

async function saveProfile(): Promise<void> {
  if (!nick.value.trim()) return
  settings.value = await window.pantry.saveProfile({
    nick: nick.value.trim(),
    company: company.value.trim(),
    dept: dept.value.trim(),
    team: team.value.trim(),
    avatar: avatar.value,
    fileDir: fileDir.value
  })
  if (settings.value) syncForm(settings.value)
  flashSaved('已保存，全网通讯录将自动刷新')
}

function chooseInitialAvatar(): void {
  avatar.value = -1
}

function chooseAvatarEmoji(index: number): void {
  avatar.value = avatarValue(index, selectedAvatarColor.value)
}

function chooseAvatarColor(index: number): void {
  const emoji = selectedAvatarEmoji.value >= 0 ? selectedAvatarEmoji.value : 0
  avatar.value = avatarValue(emoji, index)
}

function avatarOptionStyle(index: number): { backgroundColor: string; color: string } {
  return avatarStyle(avatarValue(index, selectedAvatarColor.value), nick.value || '茶')
}

async function pickFileDir(): Promise<void> {
  const dir = await window.pantry.pickDirectory()
  if (dir) fileDir.value = dir
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

async function changeTheme(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'light' || value === 'dark') await saveApp({ theme: value })
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

async function changeSendKey(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'enter' || value === 'ctrlEnter') await saveApp({ sendKey: value })
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
      captureShortcut: 'CommandOrControl+Alt+A',
      showHideShortcut: 'CommandOrControl+Alt+P'
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

async function savePorts(): Promise<void> {
  const udpPort = parsePort(udpPortInput.value)
  const tcpPort = parsePort(tcpPortInput.value)
  if (!udpPort || !tcpPort) {
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
  return `${prefix} ${conv.peerId}${conv.preview ? ` - ${conv.preview.slice(0, 18)}` : ''}`
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
  scanTip.value = count >= 0 ? `已向 ${count} 个地址发出探测` : '网段不合法'
}

async function removeRange(cidr: string): Promise<void> {
  if (!settings.value) return
  await saveApp({
    scanRanges: settings.value.scanRanges.filter((r) => r !== cidr)
  })
}
</script>

<template>
  <div class="settings">
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
            <div class="avatar-editor">
              <AvatarMark class="avatar-preview" :avatar="avatar" :name="nick || '茶'" />
              <div class="avatar-tools">
                <button
                  type="button"
                  class="avatar-initial"
                  :class="{ on: avatar === -1 }"
                  @click="chooseInitialAvatar"
                >
                  昵称首字
                </button>
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
                <input v-model="nick" maxlength="32" />
              </label>
              <label class="field">
                <span>公司</span>
                <input v-model="company" maxlength="32" />
              </label>
              <label class="field">
                <span>部门</span>
                <input v-model="dept" maxlength="32" />
              </label>
              <label class="field">
                <span>团队</span>
                <input v-model="team" maxlength="32" />
              </label>
            </div>
            <div class="panel-actions">
              <button class="primary" :disabled="!nick.trim()" @click="saveProfile">保存资料</button>
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
              <p>主题和字体缩放会同步到主窗口。</p>
            </div>
            <label class="setting-line">
              <div>
                <strong>主题</strong>
                <small>深色主题适合弱光环境。</small>
              </div>
              <select :value="settings.theme" @change="changeTheme">
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
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
            <label class="setting-line is-disabled">
              <div>
                <strong>语言</strong>
                <small>多语言为后续版本能力。</small>
              </div>
              <select disabled>
                <option>简体中文</option>
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

          <div class="panel">
            <div class="panel-head">
              <h2>输入习惯</h2>
              <p>发送键会影响所有单聊和讨论组输入框。</p>
            </div>
            <label class="setting-line">
              <div>
                <strong>发送键</strong>
                <small>另一组快捷键用于换行。</small>
              </div>
              <select :value="settings.sendKey" @change="changeSendKey">
                <option value="enter">Enter 发送</option>
                <option value="ctrlEnter">Ctrl/Cmd + Enter 发送</option>
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
              <div class="button-row">
                <button class="ghost" @click="pickFileDir">更改</button>
                <button class="primary subtle" @click="saveProfile">保存</button>
              </div>
            </div>
            <div class="setting-line is-disabled">
              <div>
                <strong>每次询问保存位置</strong>
                <small>后续版本开放。</small>
              </div>
              <label class="switch">
                <input type="checkbox" disabled />
                <span></span>
              </label>
            </div>
            <div class="setting-line is-disabled">
              <div>
                <strong>图片自动接收</strong>
                <small>20 MB 以内图片会自动进入图片缓存。</small>
              </div>
              <label class="switch">
                <input type="checkbox" checked disabled />
                <span></span>
              </label>
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
                  <small>{{ transferStatusLabel(t.status) }} - {{ transferMeta(t) }}</small>
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
            <ul v-else class="chips">
              <li v-for="r in settings.scanRanges" :key="r">
                <span>{{ r }}</span>
                <button class="icon-button" title="再次扫描" @click="rescan(r)">
                  <PantryIcon name="refresh" :size="13" />
                </button>
                <button class="icon-button" title="移除" @click="removeRange(r)">
                  <PantryIcon name="x" :size="13" />
                </button>
              </li>
            </ul>
          </div>
        </section>

        <section v-else-if="section === 'shortcuts'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>全局快捷键</h2>
              <p>留空表示禁用。保存后会立即重新注册快捷键。</p>
            </div>
            <label class="field">
              <span>截图</span>
              <input v-model="captureShortcut" maxlength="64" placeholder="留空禁用" />
            </label>
            <label class="field">
              <span>显示/隐藏主窗</span>
              <input v-model="showHideShortcut" maxlength="64" placeholder="留空禁用" />
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
              <button class="primary" @click="saveShortcuts">保存快捷键</button>
            </div>
          </div>
        </section>

        <section v-else-if="section === 'advanced'" class="page-section">
          <div class="panel">
            <div class="panel-head">
              <h2>端口</h2>
              <p>全员端口需一致。修改后重启应用生效。</p>
            </div>
            <div class="port-grid">
              <label class="field">
                <span>UDP 端口</span>
                <input v-model="udpPortInput" type="number" min="1" max="65535" />
              </label>
              <label class="field">
                <span>TCP 端口</span>
                <input v-model="tcpPortInput" type="number" min="1" max="65535" />
              </label>
            </div>
            <div class="panel-actions">
              <button class="primary" @click="savePorts">保存端口</button>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h2>维护</h2>
              <p>诊断与清理能力会逐步补齐。</p>
            </div>
            <label class="setting-line is-disabled">
              <div>
                <strong>监听网卡</strong>
                <small>当前监听全部 IPv4 网卡。</small>
              </div>
              <select disabled>
                <option>全部 IPv4 网卡</option>
              </select>
            </label>
            <div class="setting-line is-disabled">
              <div>
                <strong>诊断日志</strong>
                <small>仅导出元数据日志，不包含消息正文。</small>
              </div>
              <button class="ghost" disabled>导出</button>
            </div>
            <div class="setting-line is-disabled">
              <div>
                <strong>清理离线联系人</strong>
                <small>清理 90 天未上线联系人，后续版本开放。</small>
              </div>
              <button class="ghost" disabled>清理</button>
            </div>
          </div>
        </section>

        <section v-else class="page-section">
          <div class="about-card">
            <div class="about-mark">茶</div>
            <div>
              <h2>茶话间 Pantry</h2>
              <p>纯内网即时通讯与文件传输。无服务器，无遥测，数据不出局域网。</p>
            </div>
          </div>
          <div class="panel">
            <div class="info-grid">
              <span>应用版本</span>
              <strong>{{ info?.version ?? '-' }}</strong>
              <span>Electron</span>
              <strong>{{ info?.electron ?? '-' }}</strong>
              <span>Chromium</span>
              <strong>{{ info?.chrome ?? '-' }}</strong>
              <span>Node</span>
              <strong>{{ info?.node ?? '-' }}</strong>
              <span>本机节点</span>
              <strong>{{ info?.nodeId ?? '-' }}</strong>
              <span>许可</span>
              <strong>MIT（暂定）</strong>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.settings {
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
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.account-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--bg-list);
}

.account-avatar,
.about-mark {
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
  font-size: 13px;
  line-height: 1.4;
}

.account-copy span {
  color: var(--text-3);
  font-size: 12px;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav button {
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  text-align: left;
  padding: 0 10px;
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
  padding: 18px 22px 24px;
  overflow-y: auto;
}

.page-head {
  min-height: 58px;
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.25;
}

.page-head p,
.panel-head p,
.about-card p {
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.5;
}

.notice {
  align-self: flex-start;
  max-width: 190px;
  border-radius: 6px;
  background: var(--primary-weak);
  color: var(--primary);
  font-size: 12px;
  line-height: 1.4;
  padding: 6px 8px;
}

.page-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel,
.about-card,
.empty-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-window);
}

.panel {
  padding: 14px;
}

.panel-head {
  margin-bottom: 12px;
}

.panel-head h2,
.about-card h2 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.setting-line {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
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

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
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

.avatar-editor {
  display: grid;
  grid-template-columns: 58px 1fr;
  align-items: start;
  gap: 14px;
  margin-bottom: 14px;
}

.avatar-preview {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 26px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.avatar-tools {
  min-width: 0;
}

.avatar-initial {
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg-list);
  color: var(--text-2);
  font-size: 12px;
  padding: 0 10px;
  cursor: pointer;
  margin-bottom: 8px;
}

.avatar-initial.on {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(8, 30px);
  gap: 6px;
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
}

.avatar-choice.on {
  border-color: var(--primary);
  box-shadow:
    0 0 0 2px var(--primary-weak),
    inset 0 0 0 1px rgba(255, 255, 255, 0.78);
}

.avatar-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.color-choice {
  width: 20px;
  height: 20px;
  border: 2px solid var(--bg-window);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--line);
  cursor: pointer;
}

.color-choice.on {
  box-shadow:
    0 0 0 2px var(--primary),
    inset 0 0 0 1px rgba(255, 255, 255, 0.55);
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

.about-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}

.about-mark {
  width: 44px;
  height: 44px;
  background: var(--primary);
  color: #fff;
  font-size: 18px;
}

.info-grid {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 9px 12px;
  font-size: 13px;
}

.info-grid span {
  color: var(--text-3);
}

.info-grid strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
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

  .avatar-grid {
    grid-template-columns: repeat(6, 30px);
  }
}
</style>
