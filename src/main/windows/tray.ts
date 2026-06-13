import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { TRAY_ICON_COLOR_DATAURL, TRAY_ICON_MONO_DATAURL } from './tray-icon'
import {
  createUnreadOverlayIconDataURL,
  createUnreadTrayIconDataURL,
  trayUnreadToolTip,
  unreadBadgeText
} from './tray-badge'

export interface TrayDeps {
  showWindow: () => void
  quit: () => void
}

/** 托盘基础图（决议 #58）：mac 单色 template，Win/Linux 彩色填充版 */
function trayBaseDataURL(): string {
  return process.platform === 'darwin' ? TRAY_ICON_MONO_DATAURL : TRAY_ICON_COLOR_DATAURL
}

let flashTimer: ReturnType<typeof setInterval> | null = null
let flashOn = false

/**
 * 托盘常驻（F-SYS-1）。个别 Linux 桌面环境没有托盘协议 —— 创建失败不致命，
 * 返回 null，关窗行为由调用方降级为直接退出。
 */
export function setupTray(deps: TrayDeps): Tray | null {
  try {
    const icon = nativeImage.createFromDataURL(trayBaseDataURL())
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    const tray = new Tray(icon)
    tray.setToolTip('茶话间')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开茶话间', click: deps.showWindow },
        { type: 'separator' },
        { label: '退出', click: deps.quit }
      ])
    )
    // Windows/Linux 习惯：单击托盘直接唤起主窗
    tray.on('click', deps.showWindow)
    return tray
  } catch (err) {
    console.warn('[tray] 托盘不可用（桌面环境不支持），关窗将直接退出：', err)
    return null
  }
}

export function updateTrayUnread(tray: Tray | null, mainWindow: BrowserWindow | null, count: number): void {
  const safeCount = Math.max(0, count)
  const label = unreadBadgeText(safeCount)
  tray?.setToolTip(trayUnreadToolTip(safeCount))

  if (process.platform === 'darwin') {
    stopTrayUnreadFlash(tray)
    tray?.setTitle(label)
    app.dock?.setBadge(label)
    app.setBadgeCount(safeCount)
    return
  }

  if (process.platform === 'win32') {
    const overlay = safeCount > 0 ? nativeImage.createFromDataURL(createUnreadOverlayIconDataURL(safeCount)) : null
    mainWindow?.setOverlayIcon(overlay, safeCount > 0 ? `${label} 条未读消息` : '')
  } else if (process.platform === 'linux') {
    app.setBadgeCount(safeCount)
  }

  if (!tray) return
  if (safeCount > 0) startTrayUnreadFlash(tray, safeCount)
  else stopTrayUnreadFlash(tray)
}

export function stopTrayUnreadFlash(tray?: Tray | null): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  flashOn = false
  if (tray && process.platform !== 'darwin') {
    tray.setImage(nativeImage.createFromDataURL(trayBaseDataURL()))
  }
}

function startTrayUnreadFlash(tray: Tray, count: number): void {
  const baseIcon = nativeImage.createFromDataURL(trayBaseDataURL())
  const unreadIcon = nativeImage.createFromDataURL(createUnreadTrayIconDataURL(count))
  tray.setImage(unreadIcon)
  flashOn = true
  if (flashTimer) clearInterval(flashTimer)
  flashTimer = setInterval(() => {
    flashOn = !flashOn
    tray.setImage(flashOn ? unreadIcon : baseIcon)
  }, 800)
  flashTimer.unref?.()
}
