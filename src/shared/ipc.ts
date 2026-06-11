// IPC 契约：main 与 renderer 之间唯一的对话词汇表（tech-design §4）。
// 通道名、请求/响应类型、preload 暴露的 API 形状都只在这里定义。

import type { Platform } from './protocol'

export const IpcChannels = {
  appInfo: 'app:info',
  netState: 'net:get-state',
  peersList: 'peers:list',
  peersProbe: 'peers:probe',
  convList: 'conv:list',
  convOpen: 'conv:open',
  convMarkRead: 'conv:mark-read',
  msgPage: 'msg:page',
  msgSend: 'msg:send',
  msgResend: 'msg:resend'
} as const

/** main → renderer 的事件推送 */
export const IpcEvents = {
  peersUpdated: 'peers:updated',
  netState: 'net:state',
  msgNew: 'msg:new',
  msgStatus: 'msg:status',
  convsUpdated: 'convs:updated'
} as const

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** 通讯录条目（renderer 视图模型，由主进程的 PeerRecord 投影而来） */
export interface PeerView {
  nodeId: string
  nick: string
  company: string
  dept: string
  team: string
  avatar: number
  host: string
  platform: Platform
  ip: string
  online: boolean
  lastSeen: number
}

export interface NetState {
  ok: boolean
  udpPort: number
  /** 端口被占等启动失败原因；ok 时为空 */
  error: string
}

/** 会话视图（单聊；讨论组 v0.3 扩展） */
export interface ConversationView {
  id: string
  type: 'single'
  peerId: string
  lastTs: number
  unread: number
  pinned: boolean
  muted: boolean
  preview: string
}

export interface MessageView {
  id: string
  convId: string
  senderId: string
  isMine: boolean
  kind: 'text'
  text: string
  ts: number
  seq: number
  status: 'sending' | 'sent' | 'queued' | 'failed'
}

export interface MsgStatusEvent {
  id: string
  convId: string
  status: MessageView['status']
}

/** preload 经 contextBridge 暴露到 window.pantry 的 API 形状 */
export interface PantryApi {
  getAppInfo(): Promise<AppInfo>
  getPeers(): Promise<PeerView[]>
  getNetState(): Promise<NetState>
  /** 按需探活（F-DISC-8）；返回是否已发出 */
  probePeer(nodeId: string): Promise<boolean>
  listConversations(): Promise<ConversationView[]>
  /** 打开（或创建）与某节点的会话：清未读 + 触发探活；存储不可用时返回 null */
  openConversation(peerNodeId: string): Promise<ConversationView | null>
  markRead(convId: string): Promise<void>
  /** 倒序游标分页；beforeSeq 传 null 取最新一页，返回按时间升序 */
  pageMessages(convId: string, beforeSeq: number | null, limit?: number): Promise<MessageView[]>
  /** 发文本；超长（>800 字节）或空白返回 null */
  sendText(peerNodeId: string, text: string): Promise<MessageView | null>
  resendMessage(msgId: string): Promise<boolean>
  /** 订阅通讯录变化；返回退订函数 */
  onPeersUpdated(listener: (peers: PeerView[]) => void): () => void
  onMsgNew(listener: (msg: MessageView) => void): () => void
  onMsgStatus(listener: (event: MsgStatusEvent) => void): () => void
  onConvsUpdated(listener: (convs: ConversationView[]) => void): () => void
}
