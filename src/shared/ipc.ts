// IPC 契约：main 与 renderer 之间唯一的对话词汇表（tech-design §4）。
// 通道名、请求/响应类型、preload 暴露的 API 形状都只在这里定义。

export const IpcChannels = {
  appInfo: 'app:info'
} as const

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** preload 经 contextBridge 暴露到 window.pantry 的 API 形状 */
export interface PantryApi {
  getAppInfo(): Promise<AppInfo>
}
