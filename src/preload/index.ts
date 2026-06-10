import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  IpcEvents,
  type AppInfo,
  type NetState,
  type PantryApi,
  type PeerView
} from '../shared/ipc'

// 渲染进程一切能力的唯一入口（tech-design §2 安全基线：sandbox + contextBridge）
const api: PantryApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.appInfo),
  getNetState: (): Promise<NetState> => ipcRenderer.invoke(IpcChannels.netState),
  getPeers: (): Promise<PeerView[]> => ipcRenderer.invoke(IpcChannels.peersList),
  probePeer: (nodeId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.peersProbe, nodeId),
  onPeersUpdated: (listener: (peers: PeerView[]) => void): (() => void) => {
    const wrapped = (_event: unknown, peers: PeerView[]): void => listener(peers)
    ipcRenderer.on(IpcEvents.peersUpdated, wrapped)
    return () => ipcRenderer.removeListener(IpcEvents.peersUpdated, wrapped)
  }
}

contextBridge.exposeInMainWorld('pantry', api)
