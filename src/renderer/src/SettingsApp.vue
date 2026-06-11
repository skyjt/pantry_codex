<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo, SettingsView } from '../../shared/ipc'

// 设置独立小窗（ui-design §8 的 v0.3 子集）：我的资料 / 网络 / 关于。
// 其余分组（消息通知细项/存储/快捷键）随对应功能落地补齐。

type Section = 'profile' | 'network' | 'about'

const section = ref<Section>('profile')
const settings = ref<SettingsView | null>(null)
const info = ref<AppInfo | null>(null)
const savedTip = ref('')

// 我的资料表单
const nick = ref('')
const company = ref('')
const dept = ref('')
const team = ref('')
const fileDir = ref('')
// 网络表单
const newPeer = ref('')
const newCidr = ref('')
const scanTip = ref('')

onMounted(async () => {
  info.value = await window.pantry.getAppInfo()
  await reload()
})

async function reload(): Promise<void> {
  const s = await window.pantry.getSettings()
  settings.value = s
  nick.value = s.nick
  company.value = s.company
  dept.value = s.dept
  team.value = s.team
  fileDir.value = s.fileDir
}

function flashSaved(text = '已保存'): void {
  savedTip.value = text
  setTimeout(() => (savedTip.value = ''), 1500)
}

async function saveProfile(): Promise<void> {
  if (!nick.value.trim()) return
  settings.value = await window.pantry.saveProfile({
    nick: nick.value.trim(),
    company: company.value.trim(),
    dept: dept.value.trim(),
    team: team.value.trim(),
    fileDir: fileDir.value
  })
  flashSaved('已保存，全网通讯录将自动刷新')
}

async function pickFileDir(): Promise<void> {
  const dir = await window.pantry.pickDirectory()
  if (dir) fileDir.value = dir
}

async function toggleNotifications(): Promise<void> {
  if (!settings.value) return
  settings.value = await window.pantry.saveAppSettings({
    notifications: !settings.value.notifications
  })
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
  settings.value = await window.pantry.saveAppSettings({
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
    settings.value = await window.pantry.saveAppSettings({
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
  settings.value = await window.pantry.saveAppSettings({
    scanRanges: settings.value.scanRanges.filter((r) => r !== cidr)
  })
}
</script>

<template>
  <div class="settings">
    <nav class="nav">
      <button :class="{ on: section === 'profile' }" @click="section = 'profile'">我的资料</button>
      <button :class="{ on: section === 'network' }" @click="section = 'network'">网络</button>
      <button :class="{ on: section === 'about' }" @click="section = 'about'">关于</button>
    </nav>

    <main class="body">
      <section v-if="section === 'profile'">
        <h2>我的资料</h2>
        <label class="row"><span>昵称</span><input v-model="nick" maxlength="32" /></label>
        <label class="row"><span>公司</span><input v-model="company" maxlength="32" /></label>
        <label class="row"><span>部门</span><input v-model="dept" maxlength="32" /></label>
        <label class="row"><span>团队</span><input v-model="team" maxlength="32" /></label>
        <div class="row">
          <span>文件保存</span>
          <span class="dir">{{ fileDir || settings?.defaultFileDir }}</span>
          <button class="ghost" @click="pickFileDir">更改…</button>
        </div>
        <label class="row toggle">
          <span>新消息通知</span>
          <input
            type="checkbox"
            :checked="settings?.notifications"
            @change="toggleNotifications"
          />
        </label>
        <div class="actions">
          <span class="tip">{{ savedTip }}</span>
          <button class="primary" :disabled="!nick.trim()" @click="saveProfile">保存</button>
        </div>
      </section>

      <section v-else-if="section === 'network'">
        <h2>网络</h2>
        <p class="meta">
          监听端口：UDP {{ settings?.udpPort }} / TCP {{ settings?.tcpPort }}（全网需一致；改动需求请联系管理员）
        </p>

        <h3>手动添加节点（跨网段保底）</h3>
        <div class="inline">
          <input v-model="newPeer" placeholder="如 10.2.0.8 或 10.2.0.8:17878" @keydown.enter="addPeer" />
          <button class="primary" @click="addPeer">添加</button>
        </div>
        <ul class="chips">
          <li v-for="p in settings?.manualPeers ?? []" :key="p">
            {{ p }} <button class="x" @click="removePeer(p)">✕</button>
          </li>
        </ul>

        <h3>网段扫描</h3>
        <div class="inline">
          <input v-model="newCidr" placeholder="如 10.1.2.0/24（最大 /22）" @keydown.enter="addRange" />
          <button class="primary" @click="addRange">扫描并保存</button>
        </div>
        <ul class="chips">
          <li v-for="r in settings?.scanRanges ?? []" :key="r">
            {{ r }}
            <button class="x" title="再次扫描" @click="rescan(r)">↻</button>
            <button class="x" @click="removeRange(r)">✕</button>
          </li>
        </ul>
        <p class="tip">{{ scanTip }}</p>
      </section>

      <section v-else>
        <h2>关于</h2>
        <p class="meta">茶话间（Pantry）v{{ info?.version }}</p>
        <p class="meta">
          Electron {{ info?.electron }} · Chromium {{ info?.chrome }} · Node {{ info?.node }}
        </p>
        <p class="meta">纯内网即时通讯与文件传输 —— 数据不出局域网，无遥测。</p>
        <p class="meta">开源许可：本项目暂定 MIT；依赖许可清单随 v1.0 整理发布。</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  height: 100vh;
  background: var(--bg-window);
}
.nav {
  width: 130px;
  background: var(--bg-list);
  border-right: 1px solid var(--line);
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav button {
  border: none;
  background: transparent;
  text-align: left;
  padding: 9px 18px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.nav button.on {
  background: rgba(61, 139, 107, 0.12);
  color: var(--primary);
  font-weight: 600;
}
.body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
}
h2 {
  font-size: 16px;
  margin-bottom: 14px;
}
h3 {
  font-size: 13px;
  margin: 16px 0 8px;
  color: var(--text-2);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 13px;
}
.row > span:first-child {
  width: 64px;
  color: var(--text-2);
  flex-shrink: 0;
}
.row input[type='text'],
.row input:not([type]) {
  flex: 1;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 13px;
  outline: none;
  user-select: text;
}
.row input:focus {
  border-color: var(--primary);
}
.dir {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  word-break: break-all;
}
.toggle input {
  width: 16px;
  height: 16px;
}
.inline {
  display: flex;
  gap: 8px;
}
.inline input {
  flex: 1;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 13px;
  outline: none;
  user-select: text;
}
.chips {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
.chips li {
  background: var(--bg-list);
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: 12px;
  padding: 3px 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.x {
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 11px;
}
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}
.primary {
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  padding: 7px 22px;
  border-radius: 4px;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.4;
}
.ghost {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 4px;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--text-2);
}
.tip {
  font-size: 12px;
  color: var(--primary);
}
.meta {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 8px;
}
</style>
