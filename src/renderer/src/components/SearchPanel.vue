<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SearchResult } from '../../../shared/ipc'
import { usePeersStore } from '../stores/peers'
import { useChatStore } from '../stores/chat'
import { useGroupsStore } from '../stores/groups'
import { listTime } from '../utils/time'
import PantryIcon from './PantryIcon.vue'

// 全局搜索结果面板（ui-design §6）：联系人 / 聊天记录（按会话聚合）/ 文件，
// 防抖 200ms；点击聊天记录跳转会话并定位高亮。

const props = defineProps<{ query: string }>()
const emit = defineEmits<{ navigate: [] }>()

const peersStore = usePeersStore()
const chatStore = useChatStore()
const result = ref<SearchResult>({ peers: [], messageGroups: [], files: [] })
const searching = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.query,
  (q) => {
    if (timer) clearTimeout(timer)
    searching.value = true
    timer = setTimeout(async () => {
      result.value = await window.pantry.search(q)
      searching.value = false
    }, 200)
  },
  { immediate: true }
)

const empty = computed(
  () =>
    !searching.value &&
    result.value.peers.length === 0 &&
    result.value.messageGroups.length === 0 &&
    result.value.files.length === 0
)

const groupsStore = useGroupsStore()
const nickOf = computed(() => peersStore.nameOf) // 备注优先（F-DISC-9）

/** 会话显示名：群会话用群名，单聊用联系人名 */
function convName(convId: string, peerId: string): string {
  return convId.startsWith('group:') ? groupsStore.nameOf(peerId) : nickOf.value(peerId)
}

async function openPeer(nodeId: string): Promise<void> {
  await chatStore.openPeer(nodeId)
  emit('navigate')
}

async function openHit(convId: string, seq: number, msgId: string): Promise<void> {
  await chatStore.jumpToMessage(convId, seq, msgId)
  emit('navigate')
}
</script>

<template>
  <div class="pane">
    <div v-if="empty" class="placeholder">没有找到「{{ props.query }}」相关的内容</div>
    <div v-else class="results">
      <template v-if="result.peers.length > 0">
        <div class="sec">联系人</div>
        <div v-for="p in result.peers" :key="p.nodeId" class="item" @click="openPeer(p.nodeId)">
          <span class="t">{{ p.nick }}<em v-if="!p.online" class="off">· 离线</em></span>
          <span class="s">{{ [p.company, p.dept, p.team].filter(Boolean).join(' / ') || p.ip }}</span>
        </div>
      </template>

      <template v-if="result.messageGroups.length > 0">
        <div class="sec">聊天记录</div>
        <div
          v-for="g in result.messageGroups"
          :key="g.convId"
          class="item"
          @click="openHit(g.convId, g.latestSeq, g.latestMsgId)"
        >
          <span class="t">与 {{ convName(g.convId, g.peerId) }} 的聊天 · {{ g.count }} 条相关</span>
          <span class="s">{{ g.snippet }} <i class="time">{{ listTime(g.ts) }}</i></span>
        </div>
      </template>

      <template v-if="result.files.length > 0">
        <div class="sec">文件</div>
        <div
          v-for="f in result.files"
          :key="f.msgId"
          class="item"
          @click="openHit(f.convId, f.seq, f.msgId)"
        >
          <span class="t file-title"><PantryIcon name="file" :size="14" />{{ f.name }}</span>
          <span class="s"
            >来自与 {{ convName(f.convId, f.peerId) }} 的聊天
            <i class="time">{{ listTime(f.ts) }}</i></span
          >
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.placeholder {
  color: var(--text-3);
  font-size: 13px;
  text-align: center;
  margin-top: 24px;
}
.sec {
  font-size: 11px;
  color: var(--text-3);
  padding: 10px 12px 4px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 2px;
}
.item {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item:hover {
  background: var(--line);
}
.t {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-title {
  display: flex;
  align-items: center;
  gap: 5px;
}
.off {
  font-style: normal;
  font-size: 11px;
  color: var(--text-3);
}
.s {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time {
  font-style: normal;
  font-size: 11px;
}
</style>
