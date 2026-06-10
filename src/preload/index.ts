import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type AppInfo, type PantryApi } from '../shared/ipc'

// 渲染进程一切能力的唯一入口（tech-design §2 安全基线：sandbox + contextBridge）
const api: PantryApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.appInfo)
}

contextBridge.exposeInMainWorld('pantry', api)
