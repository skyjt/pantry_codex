import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  IpcEvents,
  type AppInfo,
  type AppSettingsPatch,
  type ConversationMessageHit,
  type ConversationSearchOptions,
  type ConversationView,
  type DataExportOptions,
  type DataImportResult,
  type ExportFormat,
  type ForwardResult,
  type ForwardTarget,
  type GroupPatch,
  type GroupView,
  type MessageView,
  type MsgStatusEvent,
  type NetState,
  type PantryApi,
  type PeerView,
  type ProfileSubmit,
  type SearchResult,
  type SettingsView,
  type StickerView,
  type TransferView
} from '../shared/ipc'

function subscribe<T>(channel: string, listener: (data: T) => void): () => void {
  const wrapped = (_event: unknown, data: T): void => listener(data)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// 渲染进程一切能力的唯一入口（tech-design §2 安全基线：sandbox + contextBridge）
const api: PantryApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.appInfo),
  openUrl: (url: string): Promise<boolean> => ipcRenderer.invoke(IpcChannels.appOpenUrl, url),
  getNetState: (): Promise<NetState> => ipcRenderer.invoke(IpcChannels.netState),
  getPeers: (): Promise<PeerView[]> => ipcRenderer.invoke(IpcChannels.peersList),
  probePeer: (nodeId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.peersProbe, nodeId),
  listConversations: (): Promise<ConversationView[]> => ipcRenderer.invoke(IpcChannels.convList),
  openConversation: (peerNodeId: string): Promise<ConversationView | null> =>
    ipcRenderer.invoke(IpcChannels.convOpen, peerNodeId),
  markRead: (convId: string): Promise<void> => ipcRenderer.invoke(IpcChannels.convMarkRead, convId),
  pinConversation: (convId: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.convPin, convId, pinned),
  muteConversation: (convId: string, muted: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.convMute, convId, muted),
  removeConversation: (convId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.convRemove, convId),
  pageMessages: (convId: string, beforeSeq: number | null, limit?: number): Promise<MessageView[]> =>
    ipcRenderer.invoke(IpcChannels.msgPage, convId, beforeSeq, limit),
  sendText: (peerNodeId: string, text: string): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.msgSend, peerNodeId, text),
  resendMessage: (msgId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.msgResend, msgId),
  recallMessage: (msgId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.msgRecall, msgId),
  forwardMessage: (msgId: string, targets: ForwardTarget[]): Promise<ForwardResult> =>
    ipcRenderer.invoke(IpcChannels.msgForward, msgId, targets),
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke(IpcChannels.settingsGet),
  saveProfile: (submit: ProfileSubmit): Promise<SettingsView> =>
    ipcRenderer.invoke(IpcChannels.settingsSaveProfile, submit),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.settingsPickDir),
  pickFiles: (directory: boolean): Promise<string[] | null> =>
    ipcRenderer.invoke(IpcChannels.filePick, directory),
  offerFiles: (peerNodeId: string, paths: string[]): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.fileOffer, peerNodeId, paths),
  offerGroupFiles: (groupId: string, paths: string[]): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.groupFileOffer, groupId, paths),
  acceptTransfer: (transferId: string, saveAs: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.fileAccept, transferId, saveAs),
  declineTransfer: (transferId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.fileDecline, transferId),
  cancelTransfer: (transferId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.fileCancel, transferId),
  revealTransfer: (transferId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.fileReveal, transferId),
  getTransfer: (transferId: string): Promise<TransferView | null> =>
    ipcRenderer.invoke(IpcChannels.transferGet, transferId),
  listTransfers: (limit?: number): Promise<TransferView[]> =>
    ipcRenderer.invoke(IpcChannels.transferList, limit),
  exportData: (format: ExportFormat, options?: DataExportOptions): Promise<string | null> =>
    ipcRenderer.invoke(IpcChannels.dataExport, format, options),
  importData: (): Promise<DataImportResult | null> => ipcRenderer.invoke(IpcChannels.dataImport),
  sendImageBytes: (peerNodeId: string, name: string, bytes: ArrayBuffer): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.imgSendBytes, peerNodeId, name, bytes),
  offerImagePath: (peerNodeId: string, path: string): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.imgOfferPath, peerNodeId, path),
  sendGroupImageBytes: (
    groupId: string,
    name: string,
    bytes: ArrayBuffer
  ): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.groupImgSendBytes, groupId, name, bytes),
  offerGroupImagePath: (groupId: string, path: string): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.groupImgOfferPath, groupId, path),
  saveImageAs: (transferId: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.imgSaveAs, transferId),
  search: (query: string): Promise<SearchResult> =>
    ipcRenderer.invoke(IpcChannels.searchQuery, query),
  searchMessages: (options: ConversationSearchOptions): Promise<ConversationMessageHit[]> =>
    ipcRenderer.invoke(IpcChannels.msgSearch, options),
  getMessageContext: (convId: string, seq: number): Promise<MessageView[]> =>
    ipcRenderer.invoke(IpcChannels.msgContext, convId, seq),
  saveAppSettings: (patch: AppSettingsPatch): Promise<SettingsView> =>
    ipcRenderer.invoke(IpcChannels.settingsSaveApp, patch),
  addManualPeer: (addr: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.netAddPeer, addr),
  scanRange: (cidr: string): Promise<number> => ipcRenderer.invoke(IpcChannels.netScan, cidr),
  setPeerRemark: (nodeId: string, remark: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.peersSetRemark, nodeId, remark),
  openSettings: (): Promise<void> => ipcRenderer.invoke(IpcChannels.uiOpenSettings),
  createGroup: (
    name: string,
    memberIds: string[],
    adminPassword?: string,
    adminHint?: string
  ): Promise<GroupView | null> =>
    ipcRenderer.invoke(IpcChannels.groupCreate, name, memberIds, adminPassword, adminHint),
  updateGroup: (groupId: string, patch: GroupPatch): Promise<GroupView | null> =>
    ipcRenderer.invoke(IpcChannels.groupUpdate, groupId, patch),
  leaveGroup: (groupId: string): Promise<void> => ipcRenderer.invoke(IpcChannels.groupLeave, groupId),
  getGroup: (groupId: string): Promise<GroupView | null> =>
    ipcRenderer.invoke(IpcChannels.groupGet, groupId),
  listGroups: (): Promise<GroupView[]> => ipcRenderer.invoke(IpcChannels.groupList),
  sendGroupText: (groupId: string, text: string, mentions?: string[]): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.groupSend, groupId, text, mentions),
  startCapture: (): Promise<void> => ipcRenderer.invoke(IpcChannels.captureStart),
  captureDone: (bytes: ArrayBuffer, send: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.captureDone, bytes, send),
  fetchStickerSource: (transferId: string): Promise<{ bytes: ArrayBuffer; ext: string } | null> =>
    ipcRenderer.invoke(IpcChannels.stickerFetchSource, transferId),
  addSticker: (bytes: ArrayBuffer, ext: string, w: number, h: number): Promise<StickerView | null> =>
    ipcRenderer.invoke(IpcChannels.stickerAdd, bytes, ext, w, h),
  listStickers: (): Promise<StickerView[]> => ipcRenderer.invoke(IpcChannels.stickerList),
  removeSticker: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannels.stickerRemove, id),
  reorderStickers: (ids: string[]): Promise<StickerView[]> =>
    ipcRenderer.invoke(IpcChannels.stickerReorder, ids),
  sendSticker: (peerNodeId: string, stickerId: string): Promise<MessageView | null> =>
    ipcRenderer.invoke(IpcChannels.stickerSend, peerNodeId, stickerId),
  onPeersUpdated: (listener) => subscribe<PeerView[]>(IpcEvents.peersUpdated, listener),
  onMsgNew: (listener) => subscribe<MessageView>(IpcEvents.msgNew, listener),
  onMsgStatus: (listener) => subscribe<MsgStatusEvent>(IpcEvents.msgStatus, listener),
  onConvsUpdated: (listener) => subscribe<ConversationView[]>(IpcEvents.convsUpdated, listener),
  onTransferUpdated: (listener) => subscribe<TransferView>(IpcEvents.transferUpdated, listener),
  onGroupUpdated: (listener) => subscribe<GroupView>(IpcEvents.groupUpdated, listener),
  onCaptureInit: (listener) => {
    const wrapped = (_e: unknown, dataUrl: string, scaleFactor: number): void =>
      listener(dataUrl, scaleFactor)
    ipcRenderer.on(IpcEvents.captureInit, wrapped)
    return () => ipcRenderer.removeListener(IpcEvents.captureInit, wrapped)
  },
  onCaptured: (listener) => subscribe<ArrayBuffer>(IpcEvents.captured, listener),
  onOpenConv: (listener) => subscribe<string>(IpcEvents.openConv, listener),
  onSettingsUpdated: (listener) => subscribe<SettingsView>(IpcEvents.settingsUpdated, listener),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IpcChannels.winMinimize),
  toggleMaximizeWindow: (): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.winToggleMaximize),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.winIsMaximized),
  onWinMaximizeChanged: (listener) => subscribe<boolean>(IpcEvents.winMaximizeChanged, listener),
  beginWindowDrag: (): Promise<void> => ipcRenderer.invoke(IpcChannels.winBeginDrag),
  endWindowDrag: (): Promise<void> => ipcRenderer.invoke(IpcChannels.winEndDrag),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IpcChannels.winClose)
}

contextBridge.exposeInMainWorld('pantry', api)
