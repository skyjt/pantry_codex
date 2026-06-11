import { app, BrowserWindow, ipcMain } from 'electron'
import { release } from 'node:os'
import { join, resolve } from 'node:path'
import { IpcChannels, IpcEvents, type AppInfo, type NetState, type PeerView } from '../shared/ipc'
import { DEFAULT_UDP_PORT } from '../shared/protocol'
import { loadAppState } from './store/app-state'
import { openDatabase, type AppDatabase } from './store/db'
import { PeersRepo } from './store/peers-repo'
import { UdpChannel } from './net/udp'
import { PeerRegistry } from './net/peer-registry'
import { Discovery, type ManualPeer } from './net/discovery'
import type { PeerRecord } from './net/peer-registry'

// Win7（NT 6.1）终端为统一 VM 部署，虚拟显卡驱动不可靠 —— 默认软渲染（tech-design §9）
if (process.platform === 'win32' && release().startsWith('6.1')) {
  app.disableHardwareAcceleration()
}

// 本机双实例联调：PANTRY_USER_DATA 隔离数据目录（同时绕开单实例锁），见 README「开发」
if (process.env['PANTRY_USER_DATA']) {
  app.setPath('userData', resolve(process.env['PANTRY_USER_DATA']))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  // ---- 网络栈（端口可被环境变量覆盖，便于联调；正式配置入设置页后接管） ----
  const udpPort = Number(process.env['PANTRY_UDP_PORT']) || DEFAULT_UDP_PORT
  const manualPeers: ManualPeer[] = (process.env['PANTRY_PEERS'] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [host, port] = item.split(':')
      return { host, port: Number(port) || DEFAULT_UDP_PORT }
    })

  const netState: NetState = { ok: false, udpPort, error: '' }
  let discovery: Discovery | null = null
  let registry: PeerRegistry | null = null
  let db: AppDatabase | null = null
  let peersRepo: PeersRepo | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function toPeerView(record: PeerRecord): PeerView {
    return {
      nodeId: record.profile.nodeId,
      nick: record.profile.nick,
      company: record.profile.company,
      dept: record.profile.dept,
      team: record.profile.team,
      avatar: record.profile.avatar,
      host: record.profile.host,
      platform: record.profile.platform,
      ip: record.ip,
      online: record.online,
      lastSeen: record.lastSeen
    }
  }

  function peerViews(): PeerView[] {
    return registry ? registry.list().map(toPeerView) : []
  }

  async function startNet(): Promise<void> {
    const state = loadAppState(app.getPath('userData'), app.getVersion())
    const udp = new UdpChannel({ port: udpPort })
    registry = new PeerRegistry(state.nodeId)
    discovery = new Discovery({ udp, registry, profile: state.profile, manualPeers })

    // 存储层：打开失败不致命（磁盘满/权限问题时退化为内存模式，重启后丢历史联系人）
    try {
      db = openDatabase(join(app.getPath('userData'), 'data', 'db', 'chat.db'))
      peersRepo = new PeersRepo(db)
      registry.seed(peersRepo.loadAll()) // 历史联系人以离线态回灌（F-DISC-7）
    } catch (err) {
      console.error('[store] 数据库打开失败，本次会话为内存模式：', err)
    }

    // 注册表变化 → 节流 200ms 推给渲染层（tech-design §4 事件推送约定）
    let pushTimer: ReturnType<typeof setTimeout> | null = null
    registry.on('updated', () => {
      if (pushTimer) return
      pushTimer = setTimeout(() => {
        pushTimer = null
        mainWindow?.webContents.send(IpcEvents.peersUpdated, peerViews())
      }, 200)
      // 落库节流 1s：≤1000 行整表 upsert 在事务内毫秒级
      if (!persistTimer) {
        persistTimer = setTimeout(() => {
          persistTimer = null
          if (registry && peersRepo) peersRepo.upsertMany(registry.list())
        }, 1000)
      }
    })

    try {
      await udp.start()
      discovery.start()
      netState.ok = true
    } catch (err) {
      // 端口被占等启动失败：进"离线模式"，窗口照常可用（tech-design §2）
      netState.ok = false
      netState.error = err instanceof Error ? err.message : String(err)
      console.error('[net] UDP 启动失败，进入离线模式：', netState.error)
    }
    mainWindow?.webContents.send(IpcEvents.netState, netState)
  }

  function createMainWindow(): void {
    mainWindow = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: '茶话间',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    // 安全红线（README）：不放行任何窗口内导航与新窗口
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

    mainWindow.once('ready-to-show', () => mainWindow?.show())
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  // ---- IPC（只做参数校验与转发，业务禁入此层 —— tech-design §3） ----
  ipcMain.handle(IpcChannels.appInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    }
  })

  ipcMain.handle(IpcChannels.netState, (): NetState => netState)

  ipcMain.handle(IpcChannels.peersList, (): PeerView[] => peerViews())

  ipcMain.handle(IpcChannels.peersProbe, (_event, nodeId: unknown): boolean => {
    if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > 64) return false
    return discovery?.probeNode(nodeId) ?? false
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createMainWindow()
    void startNet()

    // 冒烟模式：窗口能起、1.5s 后干净退出即算通过（tech-design §10 的 CI 烟测同款）
    if (process.env['PANTRY_SMOKE']) {
      setTimeout(() => app.quit(), 1500)
    }
  })

  app.on('before-quit', () => {
    discovery?.stop() // 广播 + 单播 exit，让对端立刻变灰而不是等 90s 超时
    discovery = null
    if (persistTimer) clearTimeout(persistTimer)
    try {
      if (registry && peersRepo) peersRepo.upsertMany(registry.list()) // 离场前最后一次落库
      db?.close()
    } catch (err) {
      console.error('[store] 退出落库失败：', err)
    }
    db = null
  })

  // v0.1 尚未实现托盘常驻：关窗即退出；托盘落地后改为隐藏到托盘
  app.on('window-all-closed', () => {
    app.quit()
  })
}
