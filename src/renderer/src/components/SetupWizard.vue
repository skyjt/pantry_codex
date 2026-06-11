<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SettingsView } from '../../../shared/ipc'

// 首次启动向导（F-SYS-6，ui-design §7.4）：三步必经，防止全网一片"未命名"。

const props = defineProps<{ settings: SettingsView }>()
const emit = defineEmits<{ done: [] }>()

const step = ref(1)
const nick = ref(props.settings.nick)
const company = ref(props.settings.company)
const dept = ref(props.settings.dept)
const team = ref(props.settings.team)
const avatar = ref(props.settings.avatar)
const fileDir = ref(props.settings.fileDir)

const nickOk = computed(() => nick.value.trim().length > 0 && nick.value.trim().length <= 32)
const shownDir = computed(() => fileDir.value || props.settings.defaultFileDir)

async function pickDir(): Promise<void> {
  const dir = await window.pantry.pickDirectory()
  if (dir) fileDir.value = dir
}

async function finish(): Promise<void> {
  await window.pantry.saveProfile({
    nick: nick.value.trim(),
    company: company.value.trim(),
    dept: dept.value.trim(),
    team: team.value.trim(),
    avatar: avatar.value,
    fileDir: fileDir.value
  })
  emit('done')
}
</script>

<template>
  <div class="mask">
    <div class="card">
      <div class="brand">茶话间</div>
      <div class="dots">
        <span v-for="i in 3" :key="i" class="dot" :class="{ on: step >= i }"></span>
      </div>

      <div v-if="step === 1" class="body">
        <h2>怎么称呼你？</h2>
        <p class="tip">昵称会显示在同事们的通讯录里（必填，可随时修改）</p>
        <input v-model="nick" class="field" maxlength="32" placeholder="昵称" autofocus />
        <button class="primary" :disabled="!nickOk" @click="step = 2">下一步</button>
      </div>

      <div v-else-if="step === 2" class="body">
        <h2>你在哪个团队？</h2>
        <p class="tip">选填——填了之后，你会出现在通讯录对应的分组树下</p>
        <input v-model="company" class="field" maxlength="32" placeholder="公司（选填）" />
        <input v-model="dept" class="field" maxlength="32" placeholder="部门（选填）" />
        <input v-model="team" class="field" maxlength="32" placeholder="团队（选填）" />
        <div class="actions">
          <button class="ghost" @click="step = 1">上一步</button>
          <button class="primary" @click="step = 3">下一步</button>
        </div>
      </div>

      <div v-else class="body">
        <h2>收到的文件放哪？</h2>
        <p class="tip">文件传输功能即将到来，先把目录定好</p>
        <div class="dir">
          <span class="dir-path">{{ shownDir }}</span>
          <button class="ghost small" @click="pickDir">更改…</button>
        </div>
        <div class="actions">
          <button class="ghost" @click="step = 2">上一步</button>
          <button class="primary" @click="finish">进入茶话间</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: var(--bg-chat);
  display: grid;
  place-items: center;
  z-index: 10;
}
.card {
  width: 380px;
  background: var(--bg-window);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  padding: 32px 36px 28px;
  text-align: center;
}
.brand {
  font-size: 22px;
  font-weight: 600;
  color: var(--primary);
}
.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 14px 0 22px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line);
}
.dot.on {
  background: var(--primary);
}
.body h2 {
  font-size: 17px;
  margin-bottom: 6px;
}
.tip {
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 18px;
}
.field {
  width: 100%;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 10px;
  font-size: 14px;
  outline: none;
  margin-bottom: 10px;
  user-select: text;
}
.field:focus {
  border-color: var(--primary);
}
.dir {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-list);
  border-radius: 4px;
  padding: 8px 10px;
  margin-bottom: 18px;
}
.dir-path {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  text-align: left;
  word-break: break-all;
}
.actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.primary {
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  padding: 8px 28px;
  border-radius: 4px;
  cursor: pointer;
  flex: 1;
}
.primary:disabled {
  opacity: 0.4;
  cursor: default;
}
.ghost {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text-2);
  font-size: 14px;
  padding: 8px 18px;
  border-radius: 4px;
  cursor: pointer;
}
.ghost.small {
  font-size: 12px;
  padding: 4px 10px;
}
</style>
