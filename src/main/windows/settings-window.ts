import { BrowserWindow } from 'electron'
import { join } from 'node:path'

// 设置独立小窗（决议 #3 审美轮）：640×480，左分组导航；
// 复用同一渲染包，经 #/settings 哈希路由挂载 SettingsApp。

let win: BrowserWindow | null = null

export function openSettingsWindow(parent: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 640,
    height: 480,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: '设置 - 茶话间',
    parent: parent ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/settings`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/settings' })
  }
}

export function settingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}
