import { posix, win32 } from 'node:path'
import type { MessageView } from '../shared/ipc'
import { emojiSafePlainText } from '../shared/compat-emoji'

export interface NotificationIconPathInput {
  platform: NodeJS.Platform
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}

export interface IncomingNotificationInput {
  msg: MessageView
  senderNick: string
  groupName?: string
  hidePreview: boolean
  silent: boolean
}

export interface IncomingNotificationOptions {
  title: string
  body: string
  silent: boolean
}

const MAX_NOTIFICATION_BODY_CHARS = 60

export function notificationIconPath(input: NotificationIconPathInput): string | undefined {
  if (input.platform === 'darwin') return undefined
  const path = input.platform === 'win32' ? win32 : posix
  return input.isPackaged
    ? path.join(input.resourcesPath, 'icons', 'pantry.png')
    : path.join(input.appPath, 'build', 'icons', 'window-icon.png')
}

export function messageNotificationPreview(msg: MessageView, hidePreview: boolean): string {
  if (hidePreview) return '收到一条新消息'

  const raw = mediaPreviewText(msg) ?? msg.text
  const clean = emojiSafePlainText(raw.trim()).trim() || '收到一条新消息'
  return clean.length > MAX_NOTIFICATION_BODY_CHARS
    ? `${clean.slice(0, MAX_NOTIFICATION_BODY_CHARS)}…`
    : clean
}

export function incomingNotificationOptions(input: IncomingNotificationInput): IncomingNotificationOptions {
  const previewText = messageNotificationPreview(input.msg, input.hidePreview)
  const isGroup = input.msg.convId.startsWith('group:')
  if (!isGroup) {
    return {
      title: input.senderNick,
      body: previewText,
      silent: input.silent
    }
  }

  const groupName = input.groupName?.trim() || '讨论组'
  return {
    title: input.msg.mentioned ? `${groupName}（有人@你）` : groupName,
    body: input.hidePreview ? previewText : `${input.senderNick}：${previewText}`,
    silent: input.silent
  }
}

function mediaPreviewText(msg: MessageView): string | null {
  if (msg.kind === 'image') return '[图片]'
  if (msg.kind === 'sticker') return '[表情]'
  if (msg.kind === 'file') {
    const name = msg.fileRef?.name?.trim()
    if (name) return msg.fileRef?.dir ? `[文件夹] ${name}` : `[文件] ${name}`
  }
  return null
}
