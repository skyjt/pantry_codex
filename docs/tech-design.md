# 茶话间（Pantry）技术设计文档

| | |
|---|---|
| 状态 | v0.1，基线已定（技术层授权 Claude 决策）；个别标注"实测验证"的点在脚手架期落定 |
| 日期 | 2026-06-10 |
| 关系 | 上游：[requirements.md](requirements.md)（功能）、[protocol.md](protocol.md)（协议）、[ui-design.md](ui-design.md)（界面）；硬约束：根 README「开发红线」（Electron 22.3.27 / Chrome 108 / Node 16.17 焊死） |

## 1. 选型决策总表

| 项 | 决策 | 理由（一句话） |
|---|---|---|
| 语言 | **TypeScript**（main / preload / renderer / shared 全量） | 协议报文、IPC 契约、库表全靠类型撑住多人/长期维护 |
| 构建 | **electron-vite**（Vite 5） | 一份配置管三端产物；renderer 目标 `chrome108`、main/preload 目标 `node16`，红线在构建层强制 |
| 渲染框架 | **Vue 3 + Pinia** | 组件模型贴合三栏布局；生态对中文社区友好；Chrome 108 完全兼容 |
| 样式 | **原生 CSS + CSS 变量**（ui-design §9 token 直接映射），Vue SFC scoped；不引组件库/Tailwind | 视觉自绘才能做出"微信感"；避免组件库默认样式拉低质感 |
| 图标 | **lucide** 按需内联 SVG | 线性 1.5px 风格与 UI 文档一致；内联无字体兼容问题 |
| 数据库 | **better-sqlite3**（同步 API + WAL + FTS5） | 主进程单线程同步访问最简单可靠；版本锁定在可对 Electron 22 ABI 编译通过的版本线（初判 9.x，脚手架期实测后锁死） |
| 图片处理 | **渲染进程 canvas**（缩略图、表情包压缩 WebP） | Chromium 108 原生支持 `toBlob('image/webp')`；**不引 sharp** 等 native 库，避开老 glibc 等编译雷区 |
| 日志 | 自写轻量 logger（分级、按天分文件、保留 7 天、可打包导出） | 几十行的事，不引依赖 |
| 配置 | 自写 `config.json` 原子写（临时文件 + rename） | 同上；electron-store 新版本对 Node16 不友好 |
| 打包 | **electron-builder 24.x** | 兼容 Electron 22；NSIS（x64）/ deb+AppImage / dmg+zip universal 一站式 |
| 单测 | **vitest**（跑在开发机 Node，测纯逻辑） | 协议编解码、补发队列、路径清洗、身份映射都是纯函数，最值得测 |
| E2E | Playwright `_electron`（**实测验证**与 Electron 22 的配对版本；不通则退 WebdriverIO） | 三平台冒烟仍以手测清单为主 |
| 开发机要求 | Node ≥ 18（仅工具链；产物运行时是 Electron 内置 Node 16.17，与开发机无关） | Vite 5 要求 |

依赖纪律（呼应 README 红线）：所有依赖**精确锁版本**；新增依赖前先查 `engines` 与是否含 native 模块；native 模块只允许 better-sqlite3 一个。

## 2. 进程与窗口模型

```
主进程（Node 16.17）
 ├─ 网络层（UDP 17878 / TCP 17879）   ← 全部网络 IO 在主进程
 ├─ 存储层（better-sqlite3，同步）
 ├─ 系统集成（托盘/通知/快捷键/自启/单实例锁）
 └─ 窗口管理
     ├─ 主窗口（三栏，960×640 起，关闭=隐藏到托盘）
     ├─ 设置窗口（640×480，懒创建，单例）
     └─ 截图窗口（每屏一个，frameless+透明+置顶，截完即毁）
渲染进程（Chromium 108，sandbox）
 └─ Vue 3 应用（UI 全部状态经 IPC 同步）
```

> 架构总览图：[assets/architecture.mmd](assets/architecture.mmd)（IDE / GitHub 可直接预览渲染）。

- `app.requestSingleInstanceLock()`：二开实例 → 唤起已有主窗。
- 主窗 `show: false` + `ready-to-show` 再显示，避免白屏闪烁。
- 安全基线（README 红线落点）：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；严格 CSP（`default-src 'self'`）；`will-navigate` 全拦截、`setWindowOpenHandler` 一律 deny；渲染进程只加载本地资源。
- **日志脱敏**（决议 #22）：logger 永不记录消息正文/文件内容，只记元数据（消息 ID、类型、长度、对端 nodeId）——"导出诊断日志"不等于泄聊天。
- 通知：用 Electron `Notification`（Win7 下 Electron 自带仿原生降级实现；macOS 26 未签名场景列入冒烟清单）。
- 端口被占：启动时 bind 失败 → 主窗弹引导浮层（跳设置-高级改端口），网络层降级为"离线模式"不崩溃。

## 3. 代码结构

```
src/
├─ shared/                 # 三端共享，零运行时依赖
│  ├─ protocol.ts          # 报文类型/常量（protocol.md 的 TS 化，唯一来源）
│  ├─ ipc.ts               # IPC 通道名 + 请求/响应/事件类型
│  └─ model.ts             # Peer / Message / Conversation / Transfer / Group / Sticker
├─ main/
│  ├─ index.ts             # 启动时序：锁 → 配置 → DB 迁移 → 窗口 → 网络
│  ├─ windows/             # main-window / settings-window / capture-window / tray
│  ├─ net/
│  │  ├─ udp.ts            # socket 收发、广播目标计算（多网卡枚举）、每源限速
│  │  ├─ codec.ts          # 信封编解码 + 入站校验（字段白名单/长度，手写校验器）
│  │  ├─ discovery.ts      # entry/alive/exit/presence/profile/gossip、探活、离线判定
│  │  ├─ peer-registry.ts  # 节点表（内存 + 落库）、profileRev 比对、节点缓存
│  │  ├─ messenger.ts      # msg/ack、退避重传、补发队列、去重
│  │  └─ transfer.ts       # TCP server/client、pull 流、SHA-256、限并发、断点位
│  ├─ store/
│  │  ├─ db.ts             # 打开/迁移（用户版本号 PRAGMA user_version 递增迁移）
│  │  ├─ repo/*.ts         # peers / conversations / messages / groups / transfers / stickers / queue / dedup
│  │  └─ fts.ts            # 中文按字预切 + FTS5 查询
│  ├─ services/
│  │  ├─ chat.ts           # 发消息编排：写库→网络→状态回推（核心用例层）
│  │  ├─ contacts.ts       # 通讯录树聚合、探活编排
│  │  ├─ capture.ts        # desktopCapturer 抓屏 → 截图窗 → 裁剪落剪贴板
│  │  ├─ porter.ts         # 导出（HTML/TXT/备份包）与导入（身份映射+去重）
│  │  └─ settings.ts       # config.json、数据目录迁移、自启（linux 写 autostart desktop 文件）
│  ├─ ipc/                 # handle 注册（只做参数校验+转发 services）、事件推送
│  └─ util/                # logger / paths / sanitize（文件名清洗）/ atomic-write
├─ preload/index.ts        # contextBridge 暴露 window.pantry（按 shared/ipc.ts 类型）
└─ renderer/
   ├─ app/                 # 三栏壳、路由（chat / contacts / 空状态）
   ├─ views/               # ChatView / ContactsView / SettingsApp（设置窗复用同包不同入口）/ CaptureApp
   ├─ components/          # bubble/* file-card avatar tree search-panel emoji-panel virtual-list
   ├─ stores/              # pinia：peers / convs / messages / transfers / ui / settings
   ├─ ipc.ts               # window.pantry 的薄封装 + 事件订阅分发到 store
   └─ styles/tokens.css    # ui-design §9 的 CSS 变量
```

分层铁律：renderer 永不直接碰网络/磁盘/DB——一切经 IPC；main 的 `services/` 是用例编排层，`net/`、`store/` 互不感知，由 service 串联。

远期预留（决议 #21）：将来的本地 AI 开放接口（`local-api/`，HTTP/WS 或 MCP 服务器）将作为与 `ipc/` **并列的第二个"前台"**，复用同一 `services/` 层——界面能做的（查消息、发消息、订阅事件），接口天然也能做，不需要改动业务层。当前版本不实现，但任何人不得把业务逻辑写进 `ipc/` 层（会堵死这个口子）。

## 4. IPC 契约（摘要）

调用（`ipcRenderer.invoke`，全部走 `shared/ipc.ts` 类型）：

| 通道 | 说明 |
|---|---|
| `peers:list` / `peers:probe` / `peers:addManual` / `peers:scan` | 通讯录、探活（F-DISC-8）、手动 IP、网段扫描 |
| `conv:list` / `conv:pin` / `conv:mute` / `conv:markRead` / `conv:remove` | 会话列表操作 |
| `msg:page(convId, beforeTs, n)` / `msg:send` / `msg:resend` | 消息分页（倒序游标）、发送、重发 |
| `file:offer` / `file:accept` / `file:cancel` / `file:reveal` | 文件传输四件套 |
| `group:create` / `group:update` | 讨论组 |
| `search:query(q, scope)` | 全局搜索（联系人/组/记录/文件 四分类一次返回） |
| `sticker:addFromMessage` / `sticker:list` / `sticker:remove` / `sticker:reorder` | 表情包 |
| `data:exportPreview` / `data:export` / `data:importPreview` / `data:import` | 导出导入 |
| `settings:get` / `settings:set` / `settings:migrateDataDir` | 设置与数据目录迁移 |
| `shot:start` | 触发截图流程 |

事件（main → renderer，`webContents.send`）：`peers:updated`、`msg:new`、`msg:status`（发送中/已送达/排队/失败）、`transfer:progress`（节流 ≤4 次/s）、`transfer:done|failed`、`group:updated`、`net:state`（在线/端口冲突/网卡变化）、`badge:update`。

## 5. 数据库设计（SQLite，WAL）

```sql
peers(node_id TEXT PK, nick, remark, company, dept, team, avatar INT, host, platform,
      ip, tcp_port INT, profile_rev INT, caps TEXT, ver TEXT,
      first_seen INT, last_seen INT)                        -- online 状态只存内存
conversations(id TEXT PK, type TEXT,            -- 'single'|'group'
      peer_or_group_id TEXT, last_ts INT, unread INT,
      pinned INT, muted INT, draft TEXT)
messages(id TEXT PK,                            -- 协议 msgId，全局唯一
      conv_id TEXT, sender_id TEXT, is_mine INT,
      kind TEXT, content TEXT, file_ref TEXT,   -- file_ref: JSON
      ts INT, seq INT,                          -- seq: 本地单调递增，时钟漂移兜底排序
      status TEXT)                              -- sending|sent|queued|failed|recalled
messages_fts(fts5: msg_id UNINDEXED, text)      -- 入库时中文按字空格预切；查询 phrase 匹配
groups(group_id TEXT PK, name, members TEXT, rev INT, updated_by, updated_ts INT)
transfers(transfer_id TEXT PK, msg_id, peer_id, direction, files TEXT,
      status, bytes_done INT, total INT, ts INT)
send_queue(msg_id TEXT PK, peer_id, envelope TEXT, created INT, attempts INT)
dedup(msg_id TEXT PK, recv_ts INT)
stickers(id TEXT PK, path, w INT, h INT, animated INT, sort INT, added INT)
```

- 索引：`messages(conv_id, ts, seq)`、`peers(last_seen)`、`send_queue(peer_id)`、`transfers(status)`。
- `remark` 为本地备注名（决议 #22）：仅本机、不入协议；显示与搜索优先命中备注。
- 中文搜索：FTS5 不会切中文词 → **入库时把 `text` 按字拆开以空格连接**写入 fts 表，查询同样按字拆 + `"…"` 短语匹配；文件名/联系人走 `LIKE %…%`（千级数据量足够）。
- 定时清理（启动 + 每小时）：`dedup` 超 24h、`send_queue` 超 7 天或单 peer 超 200 条（裁剪时回推 UI 标失败）；启动时将残留 `sending` 态消息复位为失败（可点重发），杜绝"永远转圈"。
- 迁移：`PRAGMA user_version` 递增 + 顺序执行迁移脚本；导入/迁移目录前自动备份 db 文件。

## 6. 数据目录

```
<dataRoot>/                  # 默认 = app.getPath('userData')/data，设置可迁移
├─ db/chat.db                # 主库（WAL）
├─ files/                    # 接收的文件（默认值，可单独改）
├─ images/                   # 图片消息缓存（收+发）
├─ stickers/                 # 表情包（压缩后的 WebP/GIF）
├─ logs/                     # 按天滚动，留 7 天
└─ config.json               # 设置（原子写）
```

迁移流程（`settings:migrateDataDir`）：校验目标可写 → 关闭 db → 复制（带进度）→ 校验文件数/大小 → 写新路径入旧位置的 `redirect.json` 与全局配置 → 重开 db；失败自动回滚。

## 7. 渲染进程要点

- **虚拟滚动**：消息列表（倒序无限滚动、按 50 条分页拉取）与通讯录扁平化树（1000 节点）两处必须虚拟化；优先自写轻量实现，复杂度超预期则退 `@vueuse/core useVirtualList`（纯逻辑库，无 DOM 依赖风险）。
- **emoji 的 Win7 彩色方案**（关键坑）：Win7 系统 emoji 是黑白残缺的 → 面板 emoji 与消息内 emoji 统一用**打包的 twemoji WebP 子集（约 300 个常用，总 ~1MB）渲染**；消息明文仍是 Unicode 字符（协议/导出不受影响），仅展示层替换为 `<img>`。三平台观感一致。注意 twemoji 图像为 **CC-BY 4.0**，须在"关于-开源许可"中署名（决议 #22）。
- **图片管线（全在 renderer canvas）**：发送图片 → `createImageBitmap` 解码 → 缩略图（≤280px）即时展示；「添加到表情」→ 静图重采样到 ≤512px → `toBlob('image/webp', 0.8)`；GIF 检测文件头 `GIF8`，≤2MB 原样收藏。产出 Blob 经 IPC（ArrayBuffer）交主进程落盘。
- **状态流**：pinia store 是 main 数据的**只读投影** + 乐观更新（发消息先插 `sending` 态，`msg:status` 事件校正）；窗口重载（开发期热更）时全量拉取重建。
- token 全部走 `styles/tokens.css` CSS 变量（深色主题 v0.4 只换变量表）。
- 性能预算（NFR 对照）：通讯录树重聚合 ≤16ms（1000 节点，主进程聚合好再推）；搜索请求防抖 200ms；`transfer:progress` 节流后 UI 才消费。

## 8. 导出 / 导入

**备份包 `.pantry-bak`**（即 zip）：

```
manifest.json    # {formatVer, exportedBy: nodeId, nick, range, counts}
messages.jsonl   # 一行一条（流式读写，不怕大）
peers.json / groups.json / stickers.json
media/<sha256 前 2 段分桶>/...   # 消息引用的图片/表情；普通文件不打包（仅保留文件名记录）
```

- **导入身份映射**（决议 #19）：`is_mine=1` 的消息 `sender_id` → 重写为本机 nodeId；其余保持原值。peer 资料按 `last_seen` 新者胜合并。
- 去重：`INSERT OR IGNORE`（消息主键即协议 msgId）；media 按 sha256 命中即跳过。
- 阅读导出：HTML（内联样式+缩略图，单文件夹自包含）/ TXT（纯文本）。
- 大库不阻塞：porter 在主进程分批（每批 500 条）执行，进度事件回推；导入前 `importPreview` 只读 manifest 给确认弹窗。

## 9. 关键技术风险与对策

| 风险 | 对策 |
|---|---|
| Win7 emoji 黑白/缺字 | twemoji 子集图片渲染（§7），不依赖系统字体 |
| Debian 10 glibc 2.28 vs CI 编译环境 | linux 侧 better-sqlite3 在 **debian:10 容器**内编译（apt 指向 archive 源）；产物在真 Debian 10 冒烟 |
| linux arm64 交叉编译 native 模块 | docker buildx + qemu；若拖累节奏，v1 先发 x64，arm64 列 P2 产物（README 平台表加注） |
| macOS 26 跑 Chromium 108 | 已知风险项（README FAQ）：输入法、通知权限、屏幕录制授权列入发布冒烟清单 |
| Win7 终端为统一 VM（虚拟显卡弱/驱动旧） | **Win7 默认禁用硬件加速走软渲染**——VM 虚拟显卡是 Electron 花屏/白屏的头号惯犯，2D 聊天界面软渲染完全流畅；其他平台默认开启，高级设置留开关 |
| Wayland 无法全局截图 | 启动检测 `XDG_SESSION_TYPE`，Wayland 下截图按钮降级提示"用系统截图后 Ctrl+V" |
| UDP 广播被交换机/AP 隔离 | 协议已有三板斧兜底（手动 IP/扫描/gossip）；FAQ 文档化引导 IT 放行 |
| 超大文件/超大图片打爆内存 | 文件收发全程流式（pull 流直写磁盘），内存中永不持有整文件；图片解码限制单图 ≤50MP |
| asar 与 native 模块 | `asarUnpack: ['**/better_sqlite3.node']` |
| 节点时钟漂移打乱消息序 | 排序键 `(ts, seq)`，seq 本地单调，乱序只影响跨机微观顺序，可接受 |
| 1000 节点报文洪峰/恶意泛洪 | codec 层每源 IP 令牌桶限速 + 总入站队列上限，超限丢弃并计数 |

## 10. 构建与 CI

- electron-builder 要点：`electronVersion: 22.3.27`；win=`nsis`(x64，不出 32 位，决议 #20)+`portable`；linux=`deb`(depends 自动)+`AppImage`；mac=`dmg`+`zip`(universal，`mergeASARs: true`)；`asar: true` + asarUnpack；productName `茶话间`，appId `com.pantry.app`（待定可改）。
- GitHub Actions 矩阵：`windows-latest`（x64）、`macos-latest`（universal）、linux 用 `debian:10` 容器 job；每平台产物冒烟脚本（启动→窗口出现→退出码 0）。
- 版本号：`package.json` 单一来源；协议 `profile.ver` 随包版本注入（"内网有新版"提示的依据，见 protocol §3）。
- 内网分发：产物 + SHA-256 校验清单一并产出。

## 11. 测试策略

- **vitest 单测**（开发机 Node 跑，不依赖 Electron）：codec 编解码与坏报文模糊样本、补发队列裁剪规则、按字分词、文件名清洗、导入身份映射/去重——纯函数全覆盖。
- **协议联调**：两个主进程实例本地回环（127.0.0.1 + 不同端口）跑发现/消息/补发/文件全流程脚本，模拟丢包（随机丢 10% UDP）。
- **三平台冒烟清单**（人工，发布前必过）：Win7 x64 VM（与生产环境一致）、Debian 10、macOS 26 各过一遍 README 红线场景 + 收发文件 + 截图 + 通知。
- E2E（Playwright `_electron`）：主流程烟测，配对版本脚手架期验证。

## 12. 里程碑与模块映射

| 版本 | 交付 | 涉及模块 |
|---|---|---|
| v0.1 | 脚手架、发现/在线/探活、单聊文本、补发、托盘通知、三栏壳 | net 全套（除 transfer）、store、chat、主窗 |
| v0.2 | 文件/文件夹传输、图片消息、emoji、历史+全局搜索 | transfer、fts、file-card、emoji-panel |
| v0.3 | 讨论组、截图、表情包、跨网段（扫描+gossip）、三级树 | groups、capture、stickers、discovery 扩展、contacts |
| v0.4 | 撤回、断点续传、导出/导入、深色主题 | messenger、transfer、porter、tokens |
| v1.0 | 三平台安装包打磨、冒烟全过、文档定稿 | CI/builder |

## 13. 变更记录

- 2026-06-10 v0.1 初稿：选型总表（TS/electron-vite/Vue3/better-sqlite3/canvas 图片管线/builder24）、进程窗口模型、目录与分层、IPC 契约、库表与中文 FTS 方案、数据目录与迁移、备份包格式与身份映射、风险对策表、CI 与测试、里程碑。
- 2026-06-10 v0.2 决议 #20（不支持 32 位）：Windows 仅 x64 产物，构建/CI 矩阵相应缩减；原 ia32 内存风险项改写为通用大文件/大图内存防护。
- 2026-06-10 v0.3 环境事实补充：内网 Win7 终端为统一 64 位 VM → Win7 默认禁用硬件加速（软渲染）；新增架构总览图 assets/architecture.mmd。
- 2026-06-10 v0.4 决议 #21 预留：本地 AI 开放接口作为未来与 `ipc/` 并列的第二前台，复用 services 层；立"业务逻辑禁入 ipc/ 层"的纪律，当前版本不实现接口本体。
- 2026-06-10 v0.5 查漏轮（决议 #22）：peers 表加 `remark`（本地备注）；日志脱敏入安全基线；twemoji CC-BY 署名；启动复位残留 sending 态。
