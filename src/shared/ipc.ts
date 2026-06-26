// IPC 契约：main 与 renderer 之间唯一的对话词汇表（tech-design §4）。
// 通道名、请求/响应类型、preload 暴露的 API 形状都只在这里定义。

import type { Platform } from './protocol'
import type { PkGame, PkRefView } from './pk'

export const IpcChannels = {
  appInfo: 'app:info',
  appOpenUrl: 'app:open-url',
  netState: 'net:get-state',
  peersList: 'peers:list',
  peersProbe: 'peers:probe',
  convList: 'conv:list',
  convOpen: 'conv:open',
  convMarkRead: 'conv:mark-read',
  convPin: 'conv:pin',
  convMute: 'conv:mute',
  convRemove: 'conv:remove',
  msgPage: 'msg:page',
  msgSend: 'msg:send',
  msgResend: 'msg:resend',
  msgRecall: 'msg:recall',
  msgNudge: 'msg:nudge',
  msgPk: 'msg:pk',
  msgForward: 'msg:forward',
  settingsGet: 'settings:get',
  settingsSaveProfile: 'settings:save-profile',
  settingsPickDir: 'settings:pick-dir',
  filePick: 'file:pick',
  fileOffer: 'file:offer',
  groupFileOffer: 'group-file:offer',
  fileAccept: 'file:accept',
  fileDecline: 'file:decline',
  fileCancel: 'file:cancel',
  fileReveal: 'file:reveal',
  transferGet: 'transfer:get',
  transferList: 'transfer:list',
  dataExport: 'data:export',
  dataImport: 'data:import',
  imgSendBytes: 'img:send-bytes',
  imgOfferPath: 'img:offer-path',
  groupImgSendBytes: 'group-img:send-bytes',
  groupImgOfferPath: 'group-img:offer-path',
  imgOpenViewer: 'img:open-viewer',
  imgFitViewerWindow: 'img:fit-viewer-window',
  imgOcrSource: 'img:ocr-source',
  imgOcrResultGet: 'img:ocr-result-get',
  imgOcrResultSet: 'img:ocr-result-set',
  imgSaveAs: 'img:save-as',
  searchQuery: 'search:query',
  msgSearch: 'msg:search',
  msgContext: 'msg:context',
  settingsSaveApp: 'settings:save-app',
  netAddPeer: 'net:add-peer',
  netScan: 'net:scan',
  netScanAllRanges: 'net:scan-all-ranges',
  peersSetRemark: 'peers:set-remark',
  uiOpenSettings: 'ui:open-settings',
  groupCreate: 'group:create',
  groupUpdate: 'group:update',
  groupLeave: 'group:leave',
  groupGet: 'group:get',
  groupList: 'group:list',
  groupSend: 'group:send',
  captureStart: 'capture:start',
  captureDone: 'capture:done',
  clipboardWriteImage: 'clipboard:write-image',
  clipboardReadImage: 'clipboard:read-image',
  stickerFetchSource: 'sticker:fetch-source',
  stickerAdd: 'sticker:add',
  stickerList: 'sticker:list',
  stickerRemove: 'sticker:remove',
  stickerReorder: 'sticker:reorder',
  stickerSend: 'sticker:send',
  /** 沉浸式无标题栏（决议 #49）：Windows/Linux 自绘窗口控制按钮用 */
  winMinimize: 'win:minimize',
  winToggleMaximize: 'win:toggle-maximize',
  winIsMaximized: 'win:is-maximized',
  /** 关闭必须走主进程（决议 #59）：DOM window.close() 会绕过 close 事件直接销毁 */
  winClose: 'win:close',
  /** Linux JS 拖拽（决议 #52）：CSS 拖拽区在 Linux 不可靠，主进程跟随光标移窗 */
  winBeginDrag: 'win:begin-drag',
  winEndDrag: 'win:end-drag',
  /** 局域网自更新：查询当前可用更新源（决议 #166） */
  updateCheck: 'update:check'
} as const

/** main → renderer 的事件推送 */
export const IpcEvents = {
  peersUpdated: 'peers:updated',
  netState: 'net:state',
  msgNew: 'msg:new',
  msgStatus: 'msg:status',
  nudgeReceived: 'msg:nudge-received',
  convsUpdated: 'convs:updated',
  transferUpdated: 'transfer:updated',
  groupUpdated: 'group:updated',
  /** 截图框选窗初始化（dataURL + 缩放系数） */
  captureInit: 'capture:init',
  /** 截图完成且选择"发送"→ 主窗（发到当前会话） */
  captured: 'ui:captured',
  /** 点击系统通知/托盘 → 主窗定位到会话 */
  openConv: 'ui:open-conv',
  /** 设置页保存后广播给所有窗口，统一主题/字体等外观 */
  settingsUpdated: 'settings:updated',
  /** 主界面全局网段刷新进度 */
  netScanProgress: 'net:scan-progress',
  /** 主窗收到 Command/Ctrl+V；renderer 只在输入框聚焦时兜底读图片剪贴板 */
  clipboardPasteImage: 'clipboard:paste-image',
  /** 窗口最大化状态变化 → 自绘控制按钮切换图标（决议 #49） */
  winMaximizeChanged: 'win:maximized-changed',
  /** 局域网自更新：可用更新源变化（决议 #166） */
  updateAvailable: 'update:available'
} as const

/** 全局快捷键出厂默认（决议 #57）：设置页"恢复默认"与主进程默认值的唯一来源 */
export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Alt+A'
export const DEFAULT_SHOWHIDE_SHORTCUT = 'CommandOrControl+Alt+P'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** 本机节点 ID（群成员面板等需区分"我"） */
  nodeId: string
}

/** 通讯录条目（renderer 视图模型，由主进程的 PeerRecord 投影而来） */
export interface PeerView {
  nodeId: string
  nick: string
  /** 本地备注名（F-DISC-9），展示时优先于 nick */
  remark: string
  company: string
  dept: string
  team: string
  host: string
  avatar: number
  platform: Platform
  ip: string
  online: boolean
  lastSeen: number
  /** 应用版本（决议 #166，自更新版本比对依据） */
  ver: string
}

/** 局域网自更新：当前可用的更新源（决议 #166）；无更新源时主进程返回 null。 */
export interface UpdateAvailability {
  /** 来源节点 nodeId */
  nodeId: string
  /** 来源节点展示名（备注优先，其次昵称） */
  fromName: string
  /** 来源节点的应用版本（高于本机） */
  version: string
  /** 本机当前版本 */
  currentVersion: string
}

export interface NetState {
  ok: boolean
  udpPort: number
  /** 端口被占等启动失败原因；ok 时为空 */
  error: string
}

export type ScanProgressStatus = 'idle' | 'running' | 'done' | 'empty' | 'unavailable'

export interface ScanProgressView {
  scanId: number
  status: ScanProgressStatus
  running: boolean
  done: number
  total: number
  rangeCount: number
  startedAt: number
  finishedAt: number
}

/** 会话视图：单聊（peerId=节点）或讨论组（peerId=groupId） */
export interface ConversationView {
  id: string
  type: 'single' | 'group'
  peerId: string
  lastTs: number
  unread: number
  pinned: boolean
  muted: boolean
  mentioned: boolean
  preview: string
}

/** 文件消息引用（messages.file_ref 的 JSON 结构） */
export interface FileRefView {
  transferId: string
  /** 群聊发送侧：同一条群消息对应的多个点对点 transfer */
  transferIds?: string[]
  name: string
  size: number
  count: number
  dir: boolean
}

export type { PkRefView }

export interface MessageView {
  id: string
  convId: string
  senderId: string
  isMine: boolean
  kind: 'text' | 'file' | 'image' | 'sticker' | 'system' | 'pk'
  text: string
  fileRef?: FileRefView
  pkRef?: PkRefView
  ts: number
  seq: number
  status: 'sending' | 'sent' | 'queued' | 'failed' | 'recalled'
  /** 入站群消息是否 @ 到本机；用于本次事件的加强提醒 */
  mentioned?: boolean
}

/** 传输状态视图（文件卡片的数据源） */
export interface TransferView {
  transferId: string
  msgId: string
  convId: string
  /** 对端节点 id：出站=接收人，入站=发送人（群聊文件接收名单用，决议 #75） */
  peerId: string
  direction: 'in' | 'out'
  status: 'offering' | 'accepted' | 'done' | 'declined' | 'canceled' | 'failed'
  bytesDone: number
  totalSize: number
  fileCount: number
  name: string
  /** 完成后：接收侧的落盘根路径（用于"打开所在文件夹"） */
  savedPath: string
}

/** 图片 OCR 只读源：主进程按 transferId 返回受限字节，不向渲染层暴露本地路径 */
export interface ImageOcrSource {
  name: string
  size: number
  bytes: ArrayBuffer
}

export interface ImageOcrBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ImageOcrToken {
  id: string
  text: string
  confidence: number
  bbox: ImageOcrBox
  lineIndex: number
  wordIndex: number
  tokenIndex: number
}

export interface ImageOcrLine {
  id: string
  text: string
  bbox: ImageOcrBox
  tokenIds: string[]
  lineIndex: number
}

export interface ImageOcrResult {
  text: string
  tokens: ImageOcrToken[]
  lines: ImageOcrLine[]
  scale: number
}

export interface MsgStatusEvent {
  id: string
  convId: string
  status: MessageView['status']
}

export interface NudgeResult {
  ok: boolean
  reason?: 'rate-limited' | 'undelivered' | 'invalid'
  retryAfterMs?: number
}

export interface NudgeEvent {
  peerId: string
  convId: string
  ts: number
}

export interface ForwardTarget {
  type: 'single' | 'group'
  id: string
}

export interface ForwardResult {
  ok: number
  total: number
  messages: MessageView[]
}

export type ExportFormat = 'backup' | 'html' | 'txt'

export interface DataExportOptions {
  convId?: string
  fromTs?: number
  toTs?: number
}

export interface DataImportResult {
  imported: number
  skipped: number
}

/** 讨论组视图（F-MSG-4）：amMember=false 表示已退出/被移出（历史保留、禁发） */
export interface GroupView {
  groupId: string
  name: string
  members: string[]
  rev: number
  amMember: boolean
  creatorIp: string
  hasAdminPassword: boolean
  adminHint: string
  /** 当前本机是否可不输入密码直接管理（无密码组的创建者/IP 兼容规则） */
  canManage: boolean
}

export interface GroupPatch {
  name?: string
  add?: string[]
  remove?: string[]
  /** 有管理密码的组执行改名/增删成员时传入；不持久化 */
  adminPassword?: string
}

/** 全局搜索（ui-design §6）：联系人 / 聊天记录（按会话聚合）/ 文件 */
export interface MessageGroupHit {
  convId: string
  peerId: string
  count: number
  snippet: string
  latestSeq: number
  latestMsgId: string
  ts: number
}

export interface FileHit {
  msgId: string
  convId: string
  peerId: string
  name: string
  ts: number
  seq: number
}

export interface SearchResult {
  peers: PeerView[]
  messageGroups: MessageGroupHit[]
  files: FileHit[]
}

export type ConversationSearchKind = 'all' | 'image' | 'file'

export interface ConversationSearchOptions {
  convId: string
  query: string
  kind: ConversationSearchKind
  fromTs?: number
  toTs?: number
  limit?: number
}

export interface ConversationMessageHit {
  msgId: string
  convId: string
  senderId: string
  isMine: boolean
  kind: 'text' | 'file' | 'image' | 'pk'
  title: string
  snippet: string
  fileRef?: FileRefView
  ts: number
  seq: number
}

/** 我的资料 + 首启向导状态（F-SYS-6） */
export interface SettingsView {
  nick: string
  company: string
  dept: string
  team: string
  host: string
  avatar: number
  setupDone: boolean
  /** 用户自选的文件保存目录；空 = 跟随默认 */
  fileDir: string
  /** 系统默认下载目录（向导第三步展示用） */
  defaultFileDir: string
  notifications: boolean
  manualPeers: string[]
  scanRanges: string[]
  scanRangeItems: ScanRangeItemView[]
  udpPort: number
  tcpPort: number
  /** 截图时隐藏茶话间窗口（决议 #22） */
  hideOnCapture: boolean
  autoLaunch: boolean
  closeToTray: boolean
  theme: 'light' | 'dark'
  fontScale: 100 | 110 | 125
  showMessagePreview: boolean
  sound: 'none' | 'drop' | 'wood' | 'ding'
  sendKey: 'enter' | 'ctrlEnter'
  /** Electron accelerator；空串 = 禁用 */
  captureShortcut: string
  /** Electron accelerator；空串 = 禁用 */
  showHideShortcut: string
  /** 全局快捷键注册结果（决议 #57）：false = 被系统占用注册失败；禁用（空串）视为 true */
  shortcutStatus: {
    capture: boolean
    showHide: boolean
  }
}

export interface ScanRangeItemView {
  cidr: string
  source: 'self' | 'remote'
  sourceNodeId?: string
  sourceName?: string
  addedAt: number
  lastAutoScanAt?: number
  /** 该网段当前在线节点数（决议 #160）：online 且 IP ∈ CIDR 的节点计数 */
  nodeCount: number
}

export interface AppSettingsPatch {
  notifications?: boolean
  manualPeers?: string[]
  scanRanges?: string[]
  udpPort?: number
  tcpPort?: number
  hideOnCapture?: boolean
  autoLaunch?: boolean
  closeToTray?: boolean
  theme?: SettingsView['theme']
  fontScale?: SettingsView['fontScale']
  showMessagePreview?: boolean
  sound?: SettingsView['sound']
  sendKey?: SettingsView['sendKey']
  captureShortcut?: string
  showHideShortcut?: string
}

export interface StickerView {
  id: string
  w: number
  h: number
  animated: boolean
}

export interface ProfileSubmit {
  nick: string
  company: string
  dept: string
  team: string
  avatar: number
  fileDir: string
}

/** preload 经 contextBridge 暴露到 window.pantry 的 API 形状 */
export interface PantryApi {
  getAppInfo(): Promise<AppInfo>
  /** 用户点击聊天链接后交给系统浏览器；仅允许 http/https */
  openUrl(url: string): Promise<boolean>
  getPeers(): Promise<PeerView[]>
  getNetState(): Promise<NetState>
  /** 局域网自更新：查询当前可用更新源，无则 null（决议 #166） */
  checkUpdate(): Promise<UpdateAvailability | null>
  /** 局域网自更新：可用更新源变化推送（决议 #166） */
  onUpdateAvailable(listener: (info: UpdateAvailability | null) => void): () => void
  /** 按需探活（F-DISC-8）；返回是否已发出 */
  probePeer(nodeId: string): Promise<boolean>
  listConversations(): Promise<ConversationView[]>
  /** 打开（或创建）与某节点的会话：清未读 + 触发探活；存储不可用时返回 null */
  openConversation(peerNodeId: string): Promise<ConversationView | null>
  markRead(convId: string): Promise<void>
  pinConversation(convId: string, pinned: boolean): Promise<void>
  muteConversation(convId: string, muted: boolean): Promise<void>
  removeConversation(convId: string): Promise<void>
  /** 倒序游标分页；beforeSeq 传 null 取最新一页，返回按时间升序 */
  pageMessages(convId: string, beforeSeq: number | null, limit?: number): Promise<MessageView[]>
  /** 发文本；超长（>800 字节）或空白返回 null */
  sendText(peerNodeId: string, text: string): Promise<MessageView | null>
  resendMessage(msgId: string): Promise<boolean>
  recallMessage(msgId: string): Promise<boolean>
  sendNudge(peerNodeId: string): Promise<NudgeResult>
  sendPk(convId: string, game: PkGame): Promise<MessageView | null>
  forwardMessage(msgId: string, targets: ForwardTarget[]): Promise<ForwardResult>
  getSettings(): Promise<SettingsView>
  /** 保存资料（向导/设置）：资料有变自动广播刷新全网 */
  saveProfile(submit: ProfileSubmit): Promise<SettingsView>
  /** 弹系统目录选择框；取消返回 null */
  pickDirectory(): Promise<string | null>
  /** 弹文件/文件夹选择框（发送用）；取消返回 null */
  pickFiles(directory: boolean): Promise<string[] | null>
  /** 发起文件传输（对方离线直接失败，不入队——决议 #4）；返回本地文件消息 */
  offerFiles(peerNodeId: string, paths: string[]): Promise<MessageView | null>
  /** 发起群聊文件传输：只投递给当前在线群成员 */
  offerGroupFiles(groupId: string, paths: string[]): Promise<MessageView | null>
  /** 接收（saveAs=true 先弹目录选择）；返回是否开始 */
  acceptTransfer(transferId: string, saveAs: boolean): Promise<boolean>
  declineTransfer(transferId: string): Promise<void>
  cancelTransfer(transferId: string): Promise<void>
  /** 完成后在文件管理器中显示 */
  revealTransfer(transferId: string): Promise<void>
  getTransfer(transferId: string): Promise<TransferView | null>
  listTransfers(limit?: number): Promise<TransferView[]>
  exportData(format: ExportFormat, options?: DataExportOptions): Promise<string | null>
  importData(): Promise<DataImportResult | null>
  /** 粘贴的图片字节 → 落本机图片缓存 → 以 purpose:image 发起传输 */
  sendImageBytes(peerNodeId: string, name: string, bytes: ArrayBuffer): Promise<MessageView | null>
  /** 磁盘上的图片文件按图片消息发送（拖拽/选择器入口） */
  offerImagePath(peerNodeId: string, path: string): Promise<MessageView | null>
  /** 群聊图片：≤10MB 按图片 offer，超限退化为普通文件 offer */
  sendGroupImageBytes(groupId: string, name: string, bytes: ArrayBuffer): Promise<MessageView | null>
  offerGroupImagePath(groupId: string, path: string): Promise<MessageView | null>
  /** 在独立图片窗口中查看，不遮挡主聊天窗口 */
  openImageViewer(transferId: string): Promise<boolean>
  /** 独立图片窗口按图片自然尺寸适配内容区，返回初始缩放比例 */
  fitImageViewerWindow(width: number, height: number): Promise<number>
  /** 图片窗口 OCR：读取已完成图片的受限字节源，不暴露路径 */
  getImageOcrSource(transferId: string): Promise<ImageOcrSource | null>
  /** 图片窗口 OCR：读取主进程会话级缓存结果，避免重新打开图片后重复识别 */
  getImageOcrResult(transferId: string, cacheKey: string): Promise<ImageOcrResult | null>
  /** 图片窗口 OCR：保存主进程会话级缓存结果，不落库 */
  saveImageOcrResult(transferId: string, cacheKey: string, result: ImageOcrResult): Promise<boolean>
  /** 大图查看器"另存为" */
  saveImageAs(transferId: string): Promise<boolean>
  /** 全局搜索（防抖在渲染层做） */
  search(query: string): Promise<SearchResult>
  /** 当前会话历史搜索：关键词 + 图片/文件/日期筛选 */
  searchMessages(options: ConversationSearchOptions): Promise<ConversationMessageHit[]>
  /** 搜索跳转：取目标 seq 前后窗口（按时间升序），用于会话内定位 */
  getMessageContext(convId: string, seq: number): Promise<MessageView[]>
  /** 应用级设置（通知/手动节点/扫描网段） */
  saveAppSettings(patch: AppSettingsPatch): Promise<SettingsView>
  /** 手动添加节点（"ip" 或 "ip:port"）：持久化 + 立即探测 */
  addManualPeer(addr: string): Promise<boolean>
  /** 扫描一个 CIDR 网段；返回探测地址数，非法网段返回 -1 */
  scanRange(cidr: string): Promise<number>
  /** 扫描所有已保存 CIDR 网段；运行中重复调用返回当前进度 */
  scanAllRanges(): Promise<ScanProgressView>
  /** 设置联系人本地备注（空串=清除） */
  setPeerRemark(nodeId: string, remark: string): Promise<void>
  /** 打开设置窗口 */
  openSettings(): Promise<void>
  /** 建讨论组（自动含自己，≥2 人）；adminPassword/adminHint 可空；返回 null 表示参数不足 */
  createGroup(
    name: string,
    memberIds: string[],
    adminPassword?: string,
    adminHint?: string
  ): Promise<GroupView | null>
  /** 改名/增删成员；按创建 IP 或管理密码校验 */
  updateGroup(groupId: string, patch: GroupPatch): Promise<GroupView | null>
  leaveGroup(groupId: string): Promise<void>
  getGroup(groupId: string): Promise<GroupView | null>
  listGroups(): Promise<GroupView[]>
  sendGroupText(groupId: string, text: string, mentions?: string[]): Promise<MessageView | null>
  /** 触发截图（等价全局快捷键） */
  startCapture(): Promise<void>
  /** 截图框选完成：写剪贴板；send=true 时同时回推主窗发送到当前会话 */
  captureDone(bytes: ArrayBuffer, send: boolean): Promise<void>
  /** 写系统图片剪贴板；表情 / 图片消息复制用 */
  writeImageToClipboard(bytes: ArrayBuffer): Promise<boolean>
  /** 读系统图片剪贴板 PNG；输入框 Command+V 兜底用 */
  readImageFromClipboard(): Promise<ArrayBuffer | null>
  /** 读取某次传输的原始字节（收藏表情的压缩流水线用，仅图片/表情类传输可读） */
  fetchStickerSource(transferId: string): Promise<{ bytes: ArrayBuffer; ext: string } | null>
  /** 保存收藏（bytes 已经渲染层压缩）；返回新表情 */
  addSticker(bytes: ArrayBuffer, ext: string, w: number, h: number): Promise<StickerView | null>
  listStickers(): Promise<StickerView[]>
  removeSticker(id: string): Promise<void>
  reorderStickers(ids: string[]): Promise<StickerView[]>
  /** 发送收藏的表情到某节点 */
  sendSticker(peerNodeId: string, stickerId: string): Promise<MessageView | null>
  /** 订阅通讯录变化；返回退订函数 */
  onPeersUpdated(listener: (peers: PeerView[]) => void): () => void
  onMsgNew(listener: (msg: MessageView) => void): () => void
  onMsgStatus(listener: (event: MsgStatusEvent) => void): () => void
  onNudgeReceived(listener: (event: NudgeEvent) => void): () => void
  onConvsUpdated(listener: (convs: ConversationView[]) => void): () => void
  onTransferUpdated(listener: (transfer: TransferView) => void): () => void
  onGroupUpdated(listener: (group: GroupView) => void): () => void
  /** 截图窗：接收屏幕图像 */
  onCaptureInit(listener: (dataUrl: string, scaleFactor: number) => void): () => void
  /** 主窗：截图选择"发送"后的字节流 */
  onCaptured(listener: (bytes: ArrayBuffer) => void): () => void
  /** 点通知/托盘后主进程要求打开某会话 */
  onOpenConv(listener: (convId: string) => void): () => void
  /** 设置变更后同步主窗/设置窗外观 */
  onSettingsUpdated(listener: (settings: SettingsView) => void): () => void
  /** 主界面全局网段刷新进度 */
  onScanProgress(listener: (progress: ScanProgressView) => void): () => void
  /** 主窗 Command/Ctrl+V 图片剪贴板兜底 */
  onClipboardPasteImage(listener: () => void): () => void
  /** 沉浸式无标题栏（决议 #49）：最小化当前窗口 */
  minimizeWindow(): Promise<void>
  /** 最大化/还原当前窗口；返回切换后是否处于最大化 */
  toggleMaximizeWindow(): Promise<boolean>
  isWindowMaximized(): Promise<boolean>
  /** 当前窗口最大化状态变化（自绘按钮切图标用） */
  onWinMaximizeChanged(listener: (maximized: boolean) => void): () => void
  /** 关闭当前窗口（决议 #59）：走主进程标准 close 流程，主窗会被拦截进托盘 */
  closeWindow(): Promise<void>
  /** Linux JS 拖拽（决议 #52）：按住拖拽带时主进程跟随光标移窗 */
  beginWindowDrag(): Promise<void>
  endWindowDrag(): Promise<void>
}
