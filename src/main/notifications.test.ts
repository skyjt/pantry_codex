import { describe, expect, it } from 'vitest'
import type { MessageView } from '../shared/ipc'
import {
  incomingNotificationOptions,
  messageNotificationPreview,
  notificationIconPath
} from './notifications'

function makeMessage(patch: Partial<MessageView>): MessageView {
  return {
    id: 'm1',
    convId: 'single:p1',
    senderId: 'p1',
    isMine: false,
    kind: 'text',
    text: '你好',
    ts: 1,
    seq: 1,
    status: 'sent',
    ...patch
  }
}

describe('notification helpers', () => {
  it('把通知正文里的内置 emoji 降级为文本占位', () => {
    const msg = makeMessage({ text: '收到👍，安排❤️ OK' })

    expect(messageNotificationPreview(msg, false)).toBe('收到[表情]，安排[表情] OK')
    expect(messageNotificationPreview(makeMessage({ text: '👍👍' }), false)).toBe('[表情]')
  })

  it('表情包、图片和文件通知使用稳定摘要', () => {
    expect(messageNotificationPreview(makeMessage({ kind: 'sticker', text: '[表情]' }), false)).toBe(
      '[表情]'
    )
    expect(messageNotificationPreview(makeMessage({ kind: 'image', text: '[图片]' }), false)).toBe(
      '[图片]'
    )
    expect(
      messageNotificationPreview(
        makeMessage({
          kind: 'file',
          text: '[文件] old',
          fileRef: { transferId: 't1', name: '资料👍.pdf', size: 1, count: 1, dir: false }
        }),
        false
      )
    ).toBe('[文件] 资料[表情].pdf')
  })

  it('群通知隐藏预览时不泄露发送人，只保留会话级标题', () => {
    const msg = makeMessage({ convId: 'group:g1', text: '秘密👍' })
    const options = incomingNotificationOptions({
      msg,
      senderNick: '张三',
      groupName: '项目群',
      hidePreview: true,
      silent: true
    })

    expect(options).toEqual({ title: '项目群', body: '收到一条新消息', silent: true })
  })

  it('Linux/Windows 通知显式使用应用图标，macOS 交给系统 app 图标', () => {
    expect(
      notificationIconPath({
        platform: 'linux',
        isPackaged: true,
        resourcesPath: '/opt/Pantry/resources',
        appPath: '/app'
      })
    ).toBe('/opt/Pantry/resources/icons/pantry.png')
    expect(
      notificationIconPath({
        platform: 'win32',
        isPackaged: false,
        resourcesPath: 'C:\\Pantry\\resources',
        appPath: 'C:\\repo'
      })
    ).toBe('C:\\repo\\build\\icons\\window-icon.png')
    expect(
      notificationIconPath({
        platform: 'darwin',
        isPackaged: true,
        resourcesPath: '/res',
        appPath: '/repo'
      })
    ).toBeUndefined()
  })
})
