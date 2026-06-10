import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// 红线（README）：渲染层基线 Chrome 108，主进程/preload 基线 Node 16.17 —— Electron 22 焊死。
// 构建目标写死在这里，越线语法在编译期直接失败。
export default defineConfig({
  main: {
    build: { target: 'node16' }
  },
  preload: {
    build: { target: 'node16' }
  },
  renderer: {
    build: { target: 'chrome108' },
    plugins: [vue()]
  }
})
