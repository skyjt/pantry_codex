import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { resolveDevRendererUrl } from '../util/renderer-url'

// 截图框选窗（F-CAP-1）：覆盖主屏的无边框置顶窗，经 #/capture 挂 CaptureApp。
// 截屏图像在窗口加载完成后经 IPC 注入（dataURL）。

let win: BrowserWindow | null = null

export function openCaptureWindow(
  bounds: Rectangle,
  dataUrl: string,
  scaleFactor: number,
  onClosed: () => void
): void {
  closeCaptureWindow()
  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => {
    win = null
    onClosed()
  })
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('capture:init', dataUrl, scaleFactor)
    win?.show()
    win?.focus()
  })

  const rendererUrl = resolveDevRendererUrl(
    process.env['ELECTRON_RENDERER_URL'],
    '/capture',
    app.isPackaged
  )
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/capture' })
  }
}

export function closeCaptureWindow(): void {
  if (win && !win.isDestroyed()) win.close()
  win = null
}
