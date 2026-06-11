import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import SettingsApp from './SettingsApp.vue'
import './styles/tokens.css'

// 同一渲染包双入口：主窗挂 App，设置窗经 #/settings 挂 SettingsApp（tech-design §3）
const root = location.hash.startsWith('#/settings') ? SettingsApp : App
createApp(root).use(createPinia()).mount('#app')
