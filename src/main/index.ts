import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification,
  protocol,
  screen,
  shell,
  type Tray
} from 'electron'
import { networkInterfaces, release } from 'node:os'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, join, resolve } from 'node:path'
import {
  IpcChannels,
  IpcEvents,
  type AppInfo,
  type AppSettingsPatch,
  type ConversationSearchOptions,
  type DataExportOptions,
  type DataImportResult,
  type ExportFormat,
  type ForwardTarget,
  type MessageView,
  type NetState,
  type PeerView,
  type ProfileSubmit,
  type SettingsView
} from '../shared/ipc'
import { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT, LIMITS } from '../shared/protocol'
import { loadAppState, saveAppSettings, saveProfile, type AppState } from './store/app-state'
import { setupTray, stopTrayUnreadFlash, updateTrayUnread } from './windows/tray'
import { openSettingsWindow } from './windows/settings-window'
import { closeCaptureWindow, openCaptureWindow } from './windows/capture-window'
import { StickerRepo } from './store/sticker-repo'
import { parseCidr } from './net/cidr'
import { TransferRepo } from './store/transfer-repo'
import { GroupRepo } from './store/group-repo'
import { FilesService } from './services/files'
import { GroupsService } from './services/groups'
import { ForwardService } from './services/forward'
import { PorterService } from './services/porter'
import { SearchService } from './services/search'
import { openDatabase, openMemoryDatabase, type AppDatabase } from './store/db'
import { PeersRepo } from './store/peers-repo'
import { ConvRepo } from './store/conv-repo'
import { MsgRepo, msgRowToView } from './store/msg-repo'
import { QueueRepo } from './store/queue-repo'
import { DedupRepo } from './store/dedup-repo'
import { UdpChannel } from './net/udp'
import { PeerRegistry } from './net/peer-registry'
import { Discovery, type ManualPeer } from './net/discovery'
import { Messenger } from './net/messenger'
import { ChatService } from './services/chat'
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

  // ---- 网络栈（环境变量仅供本机联调覆盖；正式端口从设置读取，重启生效） ----
  const envUdpPort = parsePort(process.env['PANTRY_UDP_PORT'])
  const envTcpPort = parsePort(process.env['PANTRY_TCP_PORT'])
  let udpPort = envUdpPort ?? DEFAULT_UDP_PORT
  let tcpPort = envTcpPort ?? DEFAULT_TCP_PORT
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
  const remarks = new Map<string, string>()
  let db: AppDatabase | null = null
  let peersRepo: PeersRepo | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let chat: ChatService | null = null
  let files: FilesService | null = null
  let groups: GroupsService | null = null
  let forward: ForwardService | null = null
  let porter: PorterService | null = null
  let search: SearchService | null = null
  let msgRepoRef: MsgRepo | null = null
  let stickerRepo: StickerRepo | null = null
  let capturing = false
  let pruneTimer: ReturnType<typeof setInterval> | null = null
  let appState: AppState | null = null
  let tray: Tray | null = null
  let isQuitting = false

  function parsePort(value: string | undefined): number | null {
    if (!value) return null
    const n = Number(value)
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
  }

  function parsePortValue(value: unknown): number | null {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
  }

  function showMainWindow(): void {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  function mainWindowTitle(): string {
    const nick = appState?.config.setupDone ? appState.config.nick.trim() : ''
    return nick ? `${nick}-🍵Pantry` : '茶话间'
  }

  function updateMainWindowTitle(): void {
    mainWindow?.setTitle(mainWindowTitle())
  }

  function currentLocalIpv4(): string {
    for (const list of Object.values(networkInterfaces())) {
      for (const addr of list ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) return addr.address
      }
    }
    return '127.0.0.1'
  }

  function toggleMainWindow(): void {
    if (!mainWindow) return
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
      return
    }
    showMainWindow()
  }

  function broadcastSettings(): SettingsView {
    const view = settingsView()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcEvents.settingsUpdated, view)
    }
    return view
  }

  function normalizeShortcut(input: unknown): string | null {
    if (typeof input !== 'string') return null
    const value = input.trim()
    if (value.length > 64) return null
    // Electron accelerator 只需字母、数字、空格、+、-；空串表示禁用。
    return /^[A-Za-z0-9+\- ]*$/.test(value) ? value : null
  }

  function normalizeExportOptions(input: unknown): DataExportOptions | undefined {
    if (typeof input !== 'object' || input === null) return undefined
    const raw = input as Record<string, unknown>
    const out: DataExportOptions = {}
    if (typeof raw.convId === 'string' && raw.convId.length > 0 && raw.convId.length <= 128) {
      out.convId = raw.convId
    }
    if (typeof raw.fromTs === 'number' && Number.isFinite(raw.fromTs) && raw.fromTs >= 0) {
      out.fromTs = Math.floor(raw.fromTs)
    }
    if (typeof raw.toTs === 'number' && Number.isFinite(raw.toTs) && raw.toTs >= 0) {
      out.toTs = Math.floor(raw.toTs)
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  function normalizeConversationSearch(input: unknown): ConversationSearchOptions | null {
    if (typeof input !== 'object' || input === null) return null
    const raw = input as Record<string, unknown>
    if (typeof raw.convId !== 'string' || raw.convId.length === 0 || raw.convId.length > 128) {
      return null
    }
    if (typeof raw.query !== 'string' || raw.query.length > 128) return null
    const kind =
      raw.kind === 'image' || raw.kind === 'file' || raw.kind === 'all' ? raw.kind : 'all'
    const out: ConversationSearchOptions = {
      convId: raw.convId,
      query: raw.query,
      kind
    }
    if (typeof raw.fromTs === 'number' && Number.isFinite(raw.fromTs) && raw.fromTs >= 0) {
      out.fromTs = Math.floor(raw.fromTs)
    }
    if (typeof raw.toTs === 'number' && Number.isFinite(raw.toTs) && raw.toTs >= 0) {
      out.toTs = Math.floor(raw.toTs)
    }
    if (typeof raw.limit === 'number' && Number.isInteger(raw.limit)) {
      out.limit = Math.max(1, Math.min(raw.limit, 100))
    }
    return out
  }

  function registerGlobalShortcuts(): void {
    const cfg = appState?.config
    if (!cfg) return
    globalShortcut.unregisterAll()
    const captureShortcut = cfg.captureShortcut.trim()
    if (captureShortcut) {
      const ok = globalShortcut.register(captureShortcut, () => void startCapture())
      if (!ok) console.warn('[shortcut] 截图快捷键注册失败：', captureShortcut)
    }
    const showHideShortcut = cfg.showHideShortcut.trim()
    if (showHideShortcut) {
      const ok = globalShortcut.register(showHideShortcut, () => toggleMainWindow())
      if (!ok) console.warn('[shortcut] 显示/隐藏快捷键注册失败：', showHideShortcut)
    }
  }

  function applyAutoLaunch(enabled: boolean): void {
    if (process.env['PANTRY_SMOKE']) return
    if (!app.isPackaged) return
    try {
      if (process.platform === 'linux') {
        const dir = join(app.getPath('home'), '.config', 'autostart')
        const file = join(dir, 'pantry.desktop')
        if (!enabled) {
          rmSync(file, { force: true })
          return
        }
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          file,
          [
            '[Desktop Entry]',
            'Type=Application',
            'Name=茶话间',
            `Exec="${process.execPath}"`,
            'Terminal=false',
            'X-GNOME-Autostart-enabled=true',
            ''
          ].join('\n')
        )
        return
      }
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
    } catch (err) {
      console.warn('[system] 开机自启设置失败：', err)
    }
  }

  function toPeerView(record: PeerRecord): PeerView {
    return {
      nodeId: record.profile.nodeId,
      nick: record.profile.nick,
      remark: remarks.get(record.profile.nodeId) ?? '',
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
    const state = appState
    if (!state) return
    // 手动节点 = 环境变量（联调用）∪ 设置持久化（F-DISC-2 第一板斧）
    const allManual: ManualPeer[] = [
      ...manualPeers,
      ...state.config.manualPeers.map((item) => {
        const [host, port] = item.split(':')
        return { host, port: Number(port) || udpPort }
      })
    ]
    const udp = new UdpChannel({ port: udpPort })
    registry = new PeerRegistry(state.nodeId)
    discovery = new Discovery({ udp, registry, profile: state.profile, manualPeers: allManual })

    // 存储层降级链：文件库 → 内存库（功能照常、不持久）→ 全不可用则只剩发现功能
    try {
      db = openDatabase(join(app.getPath('userData'), 'data', 'db', 'chat.db'))
    } catch (err) {
      console.error('[store] 文件库打开失败，尝试内存库：', err)
      try {
        db = openMemoryDatabase()
      } catch (err2) {
        console.error('[store] 内存库也不可用，本次会话仅发现功能：', err2)
      }
    }
    if (db) {
      peersRepo = new PeersRepo(db)
      registry.seed(peersRepo.loadAll()) // 历史联系人以离线态回灌（F-DISC-7）
      for (const [id, remark] of peersRepo.loadRemarks()) remarks.set(id, remark)

      const messenger = new Messenger({
        udp,
        registry,
        selfId: state.nodeId,
        queue: new QueueRepo(db),
        dedup: new DedupRepo(db)
      })
      chat = new ChatService({
        selfId: state.nodeId,
        convRepo: new ConvRepo(db),
        msgRepo: new MsgRepo(db),
        groupRepo: new GroupRepo(db),
        messenger,
        probe: (peerId) => {
          discovery?.probeNode(peerId) // 打开会话 → 探活（F-DISC-8）
        }
      })
      const onMessage = (msg: MessageView): void => {
        mainWindow?.webContents.send(IpcEvents.msgNew, msg)
        notifyIncoming(msg)
      }
      const onStatus = (ev: unknown): void => {
        mainWindow?.webContents.send(IpcEvents.msgStatus, ev)
      }
      const onConvs = (convs: Array<{ unread: number }>): void => {
        mainWindow?.webContents.send(IpcEvents.convsUpdated, convs)
        const total = convs.reduce((sum, c) => sum + c.unread, 0)
        updateTrayUnread(tray, mainWindow, total)
      }
      chat.on('message', onMessage)
      chat.on('status', onStatus)
      chat.on('convs', onConvs)
      onConvs(chat.listConversations())

      files = new FilesService({
        selfId: state.nodeId,
        messenger,
        registry,
        convRepo: new ConvRepo(db),
        msgRepo: new MsgRepo(db),
        transferRepo: new TransferRepo(db),
        groupRepo: new GroupRepo(db),
        tcpPort,
        getSaveDir: () =>
          appState?.config.fileDir || join(app.getPath('downloads'), '茶话间'),
        getImagesDir: () => join(app.getPath('userData'), 'data', 'images')
      })
      files.on('message', onMessage)
      files.on('status', onStatus)
      files.on('convs', onConvs)
      files.on('transfer', (view) => mainWindow?.webContents.send(IpcEvents.transferUpdated, view))
      try {
        await files.start() // TCP 数据端口
      } catch (err) {
        console.error('[files] TCP 端口监听失败，文件发送可用但无法被拉取：', err)
      }

      groups = new GroupsService({
        selfId: state.nodeId,
        messenger,
        convRepo: new ConvRepo(db),
        msgRepo: new MsgRepo(db),
        groupRepo: new GroupRepo(db),
        getSelfIp: currentLocalIpv4
      })
      groups.on('message', onMessage)
      groups.on('convs', onConvs)
      groups.on('group', (view) => mainWindow?.webContents.send(IpcEvents.groupUpdated, view))

      forward = new ForwardService({
        msgRepo: new MsgRepo(db),
        chat,
        groups,
        files
      })
      porter = new PorterService(
        db,
        state.nodeId,
        state.config.nick,
        join(app.getPath('userData'), 'data', 'imported-media')
      )
      search = new SearchService(db, registry, (id) => remarks.get(id) ?? '')
      msgRepoRef = new MsgRepo(db)
      stickerRepo = new StickerRepo(db)
      chat.prune() // 启动清理（过期队列/去重窗口），之后每小时一次
      pruneTimer = setInterval(() => chat?.prune(), 3_600_000)
      pruneTimer.unref?.()
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

  /** 内置截图（F-CAP-1）：抓主屏 → 框选窗 → 剪贴板（可选直发当前会话） */
  async function startCapture(): Promise<void> {
    if (capturing) return
    if (process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland') {
      // Wayland 无法全局抓屏（tech-design §9），降级提示
      if (Notification.isSupported()) {
        new Notification({ title: '茶话间', body: 'Wayland 下请用系统截图，然后在聊天框 Ctrl+V 发送' }).show()
      }
      return
    }
    capturing = true
    const hide = appState?.config.hideOnCapture !== false
    const wasVisible = mainWindow?.isVisible() ?? false
    try {
      if (hide && wasVisible) {
        mainWindow?.hide()
        await new Promise((r) => setTimeout(r, 180)) // 等窗口淡出再抓屏
      }
      const display = screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor)
        }
      })
      const source =
        sources.find((s) => s.display_id === String(display.id)) ?? sources[0] ?? null
      if (!source || source.thumbnail.isEmpty()) {
        capturing = false
        if (hide && wasVisible) showMainWindow()
        return
      }
      openCaptureWindow(display.bounds, source.thumbnail.toDataURL(), display.scaleFactor, () => {
        capturing = false
        if (hide && wasVisible) showMainWindow()
      })
    } catch (err) {
      console.warn('[capture] 抓屏失败（macOS 需授予屏幕录制权限）：', err)
      capturing = false
      if (hide && wasVisible) showMainWindow()
    }
  }

  /** 新消息系统通知（F-SYS-2）：窗口聚焦时不打扰（应用内角标已可见）；点击直达会话 */
  function notifyIncoming(msg: MessageView): void {
    if (msg.isMine) return
    if (msg.kind === 'system') return
    if (appState && appState.config.notifications === false) return
    if (chat?.listConversations().find((conv) => conv.id === msg.convId)?.muted) return
    if (mainWindow && mainWindow.isFocused() && mainWindow.isVisible()) return
    if (!Notification.isSupported()) return

    const nick = registry?.get(msg.senderId)?.profile.nick ?? '新消息'
    const title = msg.mentioned ? `${nick} @了你` : nick
    const preview =
      appState?.config.showMessagePreview === false
        ? '收到一条新消息'
        : msg.text.length > 60
          ? `${msg.text.slice(0, 60)}…`
          : msg.text
    const notification = new Notification({
      title,
      body: preview,
      silent: appState?.config.sound === 'none'
    })
    notification.on('click', () => {
      showMainWindow()
      mainWindow?.webContents.send(IpcEvents.openConv, msg.convId)
    })
    notification.show()
    if (process.platform === 'win32') mainWindow?.flashFrame(true) // 任务栏闪烁提醒
  }

  function createMainWindow(): void {
    mainWindow = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: mainWindowTitle(),
      // 沉浸式无标题栏（决议 #49）：mac 保留内嵌红绿灯；Win/Linux 渲染层自绘控制按钮。
      // Windows 不关 thickFrame，边缘缩放与 Aero Snap 保持系统行为；不使用透明窗口（Win7 软渲染安全）。
      // 红绿灯置于列表栏顶部留白（决议 #51）：56px 导航栏放不下三钮，不允许横跨分界线。
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 68, y: 10 } }
        : { frame: false }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    // 最大化状态推送：渲染层自绘「最大化/还原」按钮据此切图标
    mainWindow.on('maximize', () =>
      mainWindow?.webContents.send(IpcEvents.winMaximizeChanged, true)
    )
    mainWindow.on('unmaximize', () =>
      mainWindow?.webContents.send(IpcEvents.winMaximizeChanged, false)
    )

    // 安全红线（README）：不放行任何窗口内导航与新窗口
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

    mainWindow.once('ready-to-show', () => mainWindow?.show())
    // 关窗 = 进托盘常驻（F-SYS-1）；托盘不可用的桌面环境降级为直接退出
    mainWindow.on('close', (event) => {
      if (isQuitting || !tray || appState?.config.closeToTray === false) return
      event.preventDefault()
      mainWindow?.hide()
    })
    mainWindow.on('focus', () => mainWindow?.flashFrame(false))
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
      platform: process.platform,
      nodeId: appState?.nodeId ?? ''
    }
  })

  // 窗口控制（决议 #49）：按调用方 webContents 定位窗口，主窗/设置窗通用
  ipcMain.handle(IpcChannels.winMinimize, (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IpcChannels.winToggleMaximize, (event): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !win.isMaximizable()) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle(IpcChannels.winIsMaximized, (event): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // Linux JS 拖拽（决议 #52）：CSS 拖拽区在 Linux 命中不可靠（UOS 实测吞点击），
  // 渲染层按住拖拽带时由主进程按光标位置跟随移窗；单鼠标场景同一时刻只有一个拖拽。
  let dragTimer: NodeJS.Timeout | null = null

  function stopWindowDrag(): void {
    if (dragTimer) clearInterval(dragTimer)
    dragTimer = null
  }

  ipcMain.handle(IpcChannels.winBeginDrag, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isMaximized() || win.isFullScreen()) return
    stopWindowDrag()
    const cursor = screen.getCursorScreenPoint()
    const [winX, winY] = win.getPosition()
    const offsetX = cursor.x - winX
    const offsetY = cursor.y - winY
    dragTimer = setInterval(() => {
      if (win.isDestroyed()) {
        stopWindowDrag()
        return
      }
      const point = screen.getCursorScreenPoint()
      win.setPosition(point.x - offsetX, point.y - offsetY)
    }, 16)
  })

  ipcMain.handle(IpcChannels.winEndDrag, (): void => stopWindowDrag())

  ipcMain.handle(IpcChannels.appOpenUrl, async (_event, raw: unknown): Promise<boolean> => {
    if (typeof raw !== 'string' || raw.length > 2048) return false
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      await shell.openExternal(url.toString())
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IpcChannels.netState, (): NetState => netState)

  ipcMain.handle(IpcChannels.peersList, (): PeerView[] => peerViews())

  ipcMain.handle(IpcChannels.peersProbe, (_event, nodeId: unknown): boolean => {
    if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > 64) return false
    return discovery?.probeNode(nodeId) ?? false
  })

  ipcMain.handle(IpcChannels.convList, () => chat?.listConversations() ?? [])

  ipcMain.handle(IpcChannels.convOpen, (_event, peerId: unknown) => {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 64) return null
    return chat?.openConversation(peerId) ?? null
  })

  ipcMain.handle(IpcChannels.convMarkRead, (_event, convId: unknown) => {
    if (typeof convId === 'string' && convId.length <= 128) chat?.markRead(convId)
  })

  ipcMain.handle(IpcChannels.convPin, (_event, convId: unknown, pinned: unknown) => {
    if (typeof convId === 'string' && convId.length <= 128 && typeof pinned === 'boolean') {
      chat?.setPinned(convId, pinned)
    }
  })

  ipcMain.handle(IpcChannels.convMute, (_event, convId: unknown, muted: unknown) => {
    if (typeof convId === 'string' && convId.length <= 128 && typeof muted === 'boolean') {
      chat?.setMuted(convId, muted)
    }
  })

  ipcMain.handle(IpcChannels.convRemove, (_event, convId: unknown) => {
    if (typeof convId === 'string' && convId.length <= 128) chat?.removeConversation(convId)
  })

  ipcMain.handle(IpcChannels.msgPage, (_event, convId: unknown, beforeSeq: unknown, limit: unknown) => {
    if (typeof convId !== 'string' || convId.length > 128 || !chat) return []
    const before = typeof beforeSeq === 'number' && Number.isInteger(beforeSeq) ? beforeSeq : null
    const lim = typeof limit === 'number' && limit >= 1 && limit <= 200 ? limit : 50
    return chat.pageMessages(convId, before, lim)
  })

  ipcMain.handle(IpcChannels.msgSend, (_event, peerId: unknown, text: unknown) => {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 64) return null
    if (typeof text !== 'string' || text.length === 0 || text.length > 4096) return null
    return chat?.sendText(peerId, text) ?? null
  })

  ipcMain.handle(IpcChannels.msgResend, (_event, msgId: unknown): boolean => {
    if (typeof msgId !== 'string' || msgId.length === 0 || msgId.length > 64) return false
    return chat?.resend(msgId) ?? false
  })

  ipcMain.handle(IpcChannels.msgRecall, (_event, msgId: unknown): boolean => {
    if (typeof msgId !== 'string' || msgId.length === 0 || msgId.length > 64) return false
    return chat?.recall(msgId) ?? false
  })

  ipcMain.handle(IpcChannels.msgForward, async (_event, msgId: unknown, targets: unknown) => {
    if (typeof msgId !== 'string' || msgId.length === 0 || msgId.length > 64) {
      return { ok: 0, total: 0, messages: [] }
    }
    if (!Array.isArray(targets) || targets.length === 0 || targets.length > 50) {
      return { ok: 0, total: 0, messages: [] }
    }
    const clean: ForwardTarget[] = []
    for (const item of targets) {
      if (typeof item !== 'object' || item === null) continue
      const target = item as Record<string, unknown>
      if ((target.type !== 'single' && target.type !== 'group') || typeof target.id !== 'string') {
        continue
      }
      if (target.id.length === 0 || target.id.length > 64) continue
      clean.push({ type: target.type, id: target.id })
    }
    return forward?.forward(msgId, clean) ?? { ok: 0, total: clean.length, messages: [] }
  })

  function settingsView(): SettingsView {
    const c = appState?.config
    const fontScale = c && (c.fontScale === 110 || c.fontScale === 125) ? c.fontScale : 100
    const sound =
      c?.sound === 'drop' || c?.sound === 'wood' || c?.sound === 'ding' ? c.sound : 'none'
    return {
      nick: c?.nick ?? '',
      company: c?.company ?? '',
      dept: c?.dept ?? '',
      team: c?.team ?? '',
      avatar: c?.avatar ?? -1,
      setupDone: c?.setupDone ?? true,
      fileDir: c?.fileDir ?? '',
      defaultFileDir: join(app.getPath('downloads'), '茶话间'),
      notifications: c?.notifications !== false,
      manualPeers: c?.manualPeers ?? [],
      scanRanges: c?.scanRanges ?? [],
      udpPort: c?.udpPort ?? udpPort,
      tcpPort: c?.tcpPort ?? tcpPort,
      hideOnCapture: c?.hideOnCapture !== false,
      autoLaunch: c?.autoLaunch !== false,
      closeToTray: c?.closeToTray !== false,
      theme: c?.theme === 'dark' ? 'dark' : 'light',
      fontScale,
      showMessagePreview: c?.showMessagePreview !== false,
      sound,
      sendKey: c?.sendKey === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
      captureShortcut: c?.captureShortcut ?? 'CommandOrControl+Alt+A',
      showHideShortcut: c?.showHideShortcut ?? 'CommandOrControl+Alt+P'
    }
  }

  function isValidSubmit(x: unknown): x is ProfileSubmit {
    if (typeof x !== 'object' || x === null) return false
    const s = x as Record<string, unknown>
    const str = (v: unknown, max: number, allowEmpty: boolean): boolean =>
      typeof v === 'string' && v.length <= max && (allowEmpty || v.trim().length > 0)
    return (
      str(s.nick, LIMITS.nick, false) &&
      str(s.company, LIMITS.company, true) &&
      str(s.dept, LIMITS.dept, true) &&
      str(s.team, LIMITS.team, true) &&
      typeof s.avatar === 'number' &&
      Number.isInteger(s.avatar) &&
      s.avatar >= -1 &&
      s.avatar <= 999 &&
      typeof s.fileDir === 'string' &&
      s.fileDir.length <= 1024
    )
  }

  ipcMain.handle(IpcChannels.settingsGet, (): SettingsView => settingsView())

  ipcMain.handle(IpcChannels.settingsSaveProfile, (_event, submit: unknown): SettingsView => {
    if (appState && isValidSubmit(submit)) {
      saveProfile(appState, {
        nick: submit.nick.trim(),
        company: submit.company.trim(),
        dept: submit.dept.trim(),
        team: submit.team.trim(),
        avatar: submit.avatar,
        fileDir: submit.fileDir.trim()
      })
      if (db) {
        porter = new PorterService(
          db,
          appState.nodeId,
          appState.config.nick,
          join(app.getPath('userData'), 'data', 'imported-media')
        )
      }
      discovery?.announceProfile() // 资料变更即时广播（F-DISC-7 的发送侧）
      updateMainWindowTitle()
      broadcastSettings()
    }
    return settingsView()
  })

  ipcMain.handle(IpcChannels.settingsPickDir, async (): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件保存位置',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.filePick, async (_event, directory: unknown): Promise<string[] | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: directory === true ? '选择要发送的文件夹' : '选择要发送的文件',
      properties: directory === true ? ['openDirectory'] : ['openFile', 'multiSelections']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
  })

  ipcMain.handle(IpcChannels.fileOffer, async (_event, peerId: unknown, paths: unknown) => {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 64) return null
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) return null
    if (!paths.every((p) => typeof p === 'string' && p.length > 0 && p.length < 2048)) return null
    return (await files?.offerPaths(peerId, paths as string[])) ?? null
  })

  ipcMain.handle(IpcChannels.groupFileOffer, async (_event, groupId: unknown, paths: unknown) => {
    if (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 64) return null
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) return null
    if (!paths.every((p) => typeof p === 'string' && p.length > 0 && p.length < 2048)) return null
    return (await files?.offerGroupPaths(groupId, paths as string[])) ?? null
  })

  ipcMain.handle(IpcChannels.fileAccept, async (_event, transferId: unknown, saveAs: unknown) => {
    if (typeof transferId !== 'string' || transferId.length > 64 || !files) return false
    let dir: string | undefined
    if (saveAs === true && mainWindow) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '保存到…',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return false
      dir = result.filePaths[0]
    }
    return files.accept(transferId, dir)
  })

  ipcMain.handle(IpcChannels.fileDecline, async (_event, transferId: unknown) => {
    if (typeof transferId === 'string' && transferId.length <= 64) await files?.decline(transferId)
  })

  ipcMain.handle(IpcChannels.fileCancel, async (_event, transferId: unknown) => {
    if (typeof transferId === 'string' && transferId.length <= 64) await files?.cancel(transferId)
  })

  ipcMain.handle(IpcChannels.fileReveal, (_event, transferId: unknown) => {
    if (typeof transferId !== 'string' || transferId.length > 64) return
    const view = files?.transferView(transferId)
    if (view?.savedPath) shell.showItemInFolder(view.savedPath)
  })

  ipcMain.handle(IpcChannels.transferGet, (_event, transferId: unknown) => {
    if (typeof transferId !== 'string' || transferId.length > 64) return null
    return files?.transferView(transferId) ?? null
  })

  ipcMain.handle(IpcChannels.transferList, (_event, limit: unknown) => {
    const lim = typeof limit === 'number' && Number.isInteger(limit) ? limit : 30
    return files?.listTransfers(lim) ?? []
  })

  ipcMain.handle(
    IpcChannels.dataExport,
    async (_event, format: unknown, options: unknown): Promise<string | null> => {
      if (format !== 'backup' && format !== 'html' && format !== 'txt') return null
      if (!mainWindow || !porter) return null
      const fmt = format as ExportFormat
      const exportOptions = normalizeExportOptions(options)
      const ext = fmt === 'backup' ? 'pantry-bak' : fmt
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出聊天记录',
        defaultPath: `茶话间导出-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (result.canceled || !result.filePath) return null
      try {
        porter.export(fmt, result.filePath, exportOptions)
        return result.filePath
      } catch (err) {
        console.warn('[porter] 导出失败：', err)
        return null
      }
    }
  )

  ipcMain.handle(IpcChannels.dataImport, async (): Promise<DataImportResult | null> => {
    if (!mainWindow || !porter) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入聊天记录备份',
      properties: ['openFile'],
      filters: [{ name: 'Pantry Backup', extensions: ['pantry-bak', 'zip'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const imported = porter.importBackup(result.filePaths[0])
      chat?.emit('convs', chat.listConversations())
      return imported
    } catch (err) {
      console.warn('[porter] 导入失败：', err)
      return null
    }
  })

  const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

  ipcMain.handle(
    IpcChannels.imgSendBytes,
    async (_event, peerId: unknown, name: unknown, bytes: unknown) => {
      if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 64) return null
      if (typeof name !== 'string' || name.length === 0 || name.length > 128) return null
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return null
      if (bytes.byteLength > 20 * 1024 * 1024) return null
      const ext = IMG_EXTS.has(extname(name).toLowerCase()) ? extname(name).toLowerCase() : '.png'
      const dir = join(app.getPath('userData'), 'data', 'images', 'out')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${randomUUID()}${ext}`)
      writeFileSync(path, Buffer.from(bytes))
      return (await files?.offerPaths(peerId, [path], 'image')) ?? null
    }
  )

  ipcMain.handle(
    IpcChannels.groupImgSendBytes,
    async (_event, groupId: unknown, name: unknown, bytes: unknown) => {
      if (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 64) return null
      if (typeof name !== 'string' || name.length === 0 || name.length > 128) return null
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return null
      if (bytes.byteLength > 20 * 1024 * 1024) return null
      const ext = IMG_EXTS.has(extname(name).toLowerCase()) ? extname(name).toLowerCase() : '.png'
      const dir = join(app.getPath('userData'), 'data', 'images', 'out')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${randomUUID()}${ext}`)
      writeFileSync(path, Buffer.from(bytes))
      return (await files?.offerGroupPaths(groupId, [path], 'image')) ?? null
    }
  )

  ipcMain.handle(IpcChannels.imgOfferPath, async (_event, peerId: unknown, path: unknown) => {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 64) return null
    if (typeof path !== 'string' || path.length === 0 || path.length > 2048) return null
    if (!IMG_EXTS.has(extname(path).toLowerCase())) return null
    return (await files?.offerPaths(peerId, [path], 'image')) ?? null
  })

  ipcMain.handle(IpcChannels.groupImgOfferPath, async (_event, groupId: unknown, path: unknown) => {
    if (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 64) return null
    if (typeof path !== 'string' || path.length === 0 || path.length > 2048) return null
    if (!IMG_EXTS.has(extname(path).toLowerCase())) return null
    return (await files?.offerGroupPaths(groupId, [path], 'image')) ?? null
  })

  ipcMain.handle(IpcChannels.settingsSaveApp, (_event, patch: unknown): SettingsView => {
    if (appState && typeof patch === 'object' && patch !== null) {
      const p = patch as Record<string, unknown>
      const clean: AppSettingsPatch = {}
      if (typeof p.notifications === 'boolean') clean.notifications = p.notifications
      if (Array.isArray(p.manualPeers)) {
        clean.manualPeers = p.manualPeers
          .filter((s): s is string => typeof s === 'string')
          .slice(0, 100)
      }
      if (Array.isArray(p.scanRanges)) {
        clean.scanRanges = p.scanRanges
          .filter((s): s is string => typeof s === 'string')
          .slice(0, 20)
      }
      const nextUdpPort = parsePortValue(p.udpPort)
      if (nextUdpPort !== null) clean.udpPort = nextUdpPort
      const nextTcpPort = parsePortValue(p.tcpPort)
      if (nextTcpPort !== null) clean.tcpPort = nextTcpPort
      if (typeof p.hideOnCapture === 'boolean') clean.hideOnCapture = p.hideOnCapture
      if (typeof p.autoLaunch === 'boolean') clean.autoLaunch = p.autoLaunch
      if (typeof p.closeToTray === 'boolean') clean.closeToTray = p.closeToTray
      if (p.theme === 'light' || p.theme === 'dark') clean.theme = p.theme
      if (p.fontScale === 100 || p.fontScale === 110 || p.fontScale === 125) {
        clean.fontScale = p.fontScale
      }
      if (typeof p.showMessagePreview === 'boolean') {
        clean.showMessagePreview = p.showMessagePreview
      }
      if (p.sound === 'none' || p.sound === 'drop' || p.sound === 'wood' || p.sound === 'ding') {
        clean.sound = p.sound
      }
      if (p.sendKey === 'enter' || p.sendKey === 'ctrlEnter') clean.sendKey = p.sendKey
      const captureShortcut = normalizeShortcut(p.captureShortcut)
      if (captureShortcut !== null) clean.captureShortcut = captureShortcut
      const showHideShortcut = normalizeShortcut(p.showHideShortcut)
      if (showHideShortcut !== null) clean.showHideShortcut = showHideShortcut
      saveAppSettings(appState, clean)
      if (clean.autoLaunch !== undefined) applyAutoLaunch(clean.autoLaunch)
      if (clean.captureShortcut !== undefined || clean.showHideShortcut !== undefined) {
        registerGlobalShortcuts()
      }
      return broadcastSettings()
    }
    return settingsView()
  })

  const ADDR_RE = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/

  ipcMain.handle(IpcChannels.netAddPeer, (_event, addr: unknown): boolean => {
    if (typeof addr !== 'string' || !appState) return false
    const m = ADDR_RE.exec(addr.trim())
    if (!m) return false
    const host = m[1]
    const port = m[2] ? Number(m[2]) : udpPort
    if (port < 1 || port > 65535) return false
    const normalized = m[2] ? `${host}:${port}` : host
    if (!appState.config.manualPeers.includes(normalized)) {
      saveAppSettings(appState, {
        manualPeers: [...appState.config.manualPeers, normalized].slice(0, 100)
      })
    }
    discovery?.probe(host, port) // 立即探测，秒回 alive 即上列表
    return true
  })

  ipcMain.handle(IpcChannels.netScan, (_event, cidr: unknown): number => {
    if (typeof cidr !== 'string' || !discovery) return -1
    const hosts = parseCidr(cidr)
    if (!hosts) return -1
    return discovery.scanHosts(hosts, udpPort)
  })

  ipcMain.handle(IpcChannels.peersSetRemark, (_event, nodeId: unknown, remark: unknown) => {
    if (typeof nodeId !== 'string' || nodeId.length === 0 || nodeId.length > 64) return
    if (typeof remark !== 'string' || remark.length > 32) return
    const trimmed = remark.trim()
    peersRepo?.setRemark(nodeId, trimmed)
    if (trimmed) remarks.set(nodeId, trimmed)
    else remarks.delete(nodeId)
    mainWindow?.webContents.send(IpcEvents.peersUpdated, peerViews())
  })

  ipcMain.handle(IpcChannels.uiOpenSettings, () => {
    openSettingsWindow(mainWindow)
  })

  ipcMain.handle(
    IpcChannels.groupCreate,
    (
      _event,
      name: unknown,
      memberIds: unknown,
      adminPassword: unknown,
      adminHint: unknown
    ) => {
      if (typeof name !== 'string' || name.length > 32) return null
      if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > 64) {
        return null
      }
      if (!memberIds.every((m) => typeof m === 'string' && m.length > 0 && m.length <= 64)) {
        return null
      }
      const secret = typeof adminPassword === 'string' && adminPassword.length <= 64 ? adminPassword : ''
      const hint = typeof adminHint === 'string' && adminHint.length <= 40 ? adminHint : ''
      return groups?.createGroup(name, memberIds as string[], secret, hint) ?? null
    }
  )

  ipcMain.handle(IpcChannels.groupUpdate, (_event, groupId: unknown, patch: unknown) => {
    if (typeof groupId !== 'string' || groupId.length > 64) return null
    if (typeof patch !== 'object' || patch === null) return null
    const p = patch as Record<string, unknown>
    const clean: { name?: string; add?: string[]; remove?: string[]; adminPassword?: string } = {}
    if (typeof p.name === 'string' && p.name.length <= 32) clean.name = p.name
    if (typeof p.adminPassword === 'string' && p.adminPassword.length <= 64) {
      clean.adminPassword = p.adminPassword
    }
    const ids = (v: unknown): string[] | undefined =>
      Array.isArray(v) && v.every((m) => typeof m === 'string' && m.length <= 64)
        ? (v as string[]).slice(0, 64)
        : undefined
    clean.add = ids(p.add)
    clean.remove = ids(p.remove)
    return groups?.updateGroup(groupId, clean) ?? null
  })

  ipcMain.handle(IpcChannels.groupLeave, (_event, groupId: unknown) => {
    if (typeof groupId === 'string' && groupId.length <= 64) groups?.leaveGroup(groupId)
  })

  ipcMain.handle(IpcChannels.groupGet, (_event, groupId: unknown) => {
    if (typeof groupId !== 'string' || groupId.length > 64) return null
    return groups?.get(groupId) ?? null
  })

  ipcMain.handle(IpcChannels.groupList, () => groups?.list() ?? [])

  ipcMain.handle(IpcChannels.groupSend, (_event, groupId: unknown, text: unknown, mentions: unknown) => {
    if (typeof groupId !== 'string' || groupId.length > 64) return null
    if (typeof text !== 'string' || text.length === 0 || text.length > 4096) return null
    const cleanMentions =
      Array.isArray(mentions) && mentions.every((m) => typeof m === 'string' && m.length <= 64)
        ? (mentions as string[]).slice(0, 50)
        : []
    return groups?.sendText(groupId, text, cleanMentions) ?? null
  })

  ipcMain.handle(IpcChannels.captureStart, () => startCapture())

  ipcMain.handle(IpcChannels.captureDone, (_event, bytes: unknown, send: unknown) => {
    closeCaptureWindow()
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return
    if (bytes.byteLength > 30 * 1024 * 1024) return
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) return
    clipboard.writeImage(image) // 始终进剪贴板（随处可贴）
    if (send === true && mainWindow) {
      showMainWindow()
      mainWindow.webContents.send(IpcEvents.captured, bytes)
    }
  })

  const stickersDir = (): string => join(app.getPath('userData'), 'data', 'stickers')

  ipcMain.handle(IpcChannels.stickerFetchSource, (_event, transferId: unknown) => {
    if (typeof transferId !== 'string' || transferId.length > 64) return null
    const view = files?.transferView(transferId)
    if (!view?.savedPath) return null
    try {
      const buf = readFileSync(view.savedPath)
      if (buf.length > 25 * 1024 * 1024) return null
      const ext = extname(view.savedPath).toLowerCase() || '.png'
      return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ext }
    } catch {
      return null
    }
  })

  ipcMain.handle(
    IpcChannels.stickerAdd,
    (_event, bytes: unknown, ext: unknown, w: unknown, h: unknown) => {
      if (!stickerRepo) return null
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return null
      if (bytes.byteLength > 2 * 1024 * 1024) return null // GIF ≤2MB / 静图压缩后远小于此
      if (ext !== '.webp' && ext !== '.gif' && ext !== '.png') return null
      const width = typeof w === 'number' && w > 0 ? Math.round(w) : 0
      const height = typeof h === 'number' && h > 0 ? Math.round(h) : 0
      const id = randomUUID()
      mkdirSync(stickersDir(), { recursive: true })
      const path = join(stickersDir(), `${id}${ext}`)
      writeFileSync(path, Buffer.from(bytes))
      stickerRepo.insert(id, path, width, height, ext === '.gif')
      return { id, w: width, h: height, animated: ext === '.gif' }
    }
  )

  ipcMain.handle(IpcChannels.stickerList, () =>
    (stickerRepo?.list() ?? []).map((r) => ({
      id: r.id,
      w: r.w,
      h: r.h,
      animated: r.animated !== 0
    }))
  )

  ipcMain.handle(IpcChannels.stickerRemove, (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 64 || !stickerRepo) return
    const path = stickerRepo.remove(id)
    if (path) rmSync(path, { force: true })
  })

  ipcMain.handle(IpcChannels.stickerReorder, (_event, ids: unknown) => {
    if (!stickerRepo || !Array.isArray(ids)) return []
    const clean = ids.filter((id): id is string => typeof id === 'string' && id.length <= 64)
    stickerRepo.reorder(clean)
    return stickerRepo.list().map((r) => ({
      id: r.id,
      w: r.w,
      h: r.h,
      animated: r.animated !== 0
    }))
  })

  ipcMain.handle(IpcChannels.stickerSend, async (_event, peerId: unknown, id: unknown) => {
    if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 64) return null
    if (typeof id !== 'string' || id.length > 64 || !stickerRepo) return null
    const row = stickerRepo.get(id)
    if (!row) return null
    return (await files?.offerPaths(peerId, [row.path], 'sticker')) ?? null
  })

  ipcMain.handle(IpcChannels.searchQuery, (_event, query: unknown) => {
    if (typeof query !== 'string' || query.length > 64 || !search) {
      return { peers: [], messageGroups: [], files: [] }
    }
    return search.query(query)
  })

  ipcMain.handle(IpcChannels.msgSearch, (_event, options: unknown) => {
    const clean = normalizeConversationSearch(options)
    if (!clean || !search) return []
    return search.conversation(clean)
  })

  ipcMain.handle(IpcChannels.msgContext, (_event, convId: unknown, seq: unknown) => {
    if (typeof convId !== 'string' || convId.length > 128 || !msgRepoRef) return []
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return []
    return msgRepoRef.around(convId, seq, 25).map(msgRowToView)
  })

  ipcMain.handle(IpcChannels.imgSaveAs, async (_event, transferId: unknown): Promise<boolean> => {
    if (typeof transferId !== 'string' || transferId.length > 64 || !mainWindow) return false
    const view = files?.transferView(transferId)
    if (!view?.savedPath) return false
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '图片另存为',
      defaultPath: basename(view.savedPath)
    })
    if (result.canceled || !result.filePath) return false
    try {
      copyFileSync(view.savedPath, result.filePath)
      return true
    } catch (err) {
      console.warn('[files] 图片另存失败：', err)
      return false
    }
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    appState = loadAppState(app.getPath('userData'), app.getVersion(), tcpPort, udpPort)
    udpPort = envUdpPort ?? appState.config.udpPort
    tcpPort = envTcpPort ?? appState.config.tcpPort
    netState.udpPort = udpPort
    appState.profile.tcpPort = tcpPort
    applyAutoLaunch(appState.config.autoLaunch)

    // pantry-img://<transferId> —— 渲染层取图的唯一通道（绕开 file:// 的 CSP/安全限制，
    // 且只放行 transfers 表里登记过的路径，不开任意文件读取口子）
    protocol.registerFileProtocol('pantry-img', (request, callback) => {
      try {
        const transferId = new URL(request.url).hostname
        const view = files?.transferView(transferId)
        if (view?.savedPath) {
          callback({ path: view.savedPath })
          return
        }
      } catch {
        // fallthrough
      }
      callback({ error: -6 }) // net::ERR_FILE_NOT_FOUND
    })

    // pantry-sticker://<id> —— 同理，只放行表情库登记过的路径
    protocol.registerFileProtocol('pantry-sticker', (request, callback) => {
      try {
        const id = new URL(request.url).hostname
        const row = stickerRepo?.get(id)
        if (row) {
          callback({ path: row.path })
          return
        }
      } catch {
        // fallthrough
      }
      callback({ error: -6 })
    })

    createMainWindow()
    tray = setupTray({
      showWindow: showMainWindow,
      quit: () => {
        isQuitting = true
        app.quit()
      }
    })
    void startNet()
    registerGlobalShortcuts()

    // 冒烟模式：窗口能起、1.5s 后干净退出即算通过（tech-design §10 的 CI 烟测同款）
    if (process.env['PANTRY_SMOKE']) {
      setTimeout(() => {
        isQuitting = true
        app.quit()
      }, 1500)
    }
  })

  app.on('activate', () => showMainWindow()) // macOS 点 Dock 唤起

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.on('before-quit', () => {
    isQuitting = true
    stopTrayUnreadFlash(tray)
    discovery?.stop() // 广播 + 单播 exit，让对端立刻变灰而不是等 90s 超时
    discovery = null
    if (pruneTimer) clearInterval(pruneTimer)
    if (persistTimer) clearTimeout(persistTimer)
    void files?.stop()
    try {
      if (registry && peersRepo) peersRepo.upsertMany(registry.list()) // 离场前最后一次落库
      db?.close()
    } catch (err) {
      console.error('[store] 退出落库失败：', err)
    }
    db = null
  })

  // 所有窗口都关闭时退出；主窗关闭到托盘由 createMainWindow 的 close 事件拦截。
  app.on('window-all-closed', () => {
    app.quit()
  })
}
