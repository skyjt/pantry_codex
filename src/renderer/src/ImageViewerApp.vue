<script setup lang="ts">
import { computed } from 'vue'
import ImageViewer from './components/ImageViewer.vue'

const params = computed(() => {
  const query = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : ''
  return new URLSearchParams(query)
})

const transferId = computed(() => params.value.get('transferId') ?? '')
const src = computed(() => (transferId.value ? `pantry-img://${transferId.value}` : ''))

function closeViewer(): void {
  void window.pantry.closeWindow()
}
</script>

<template>
  <ImageViewer
    v-if="transferId"
    :src="src"
    :transfer-id="transferId"
    @close="closeViewer"
  />
  <main v-else class="missing">
    <span>图片不可用</span>
  </main>
</template>

<style scoped>
.missing {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-2);
  background: var(--bg-chat);
  font-size: 13px;
}
</style>
