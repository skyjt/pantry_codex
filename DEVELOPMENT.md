# 二次开发指南

这份文档讲茶话间的**代码长什么样、怎么组织、想改造从哪下手**，写给打算读源码、改功能或做二次开发的人。

- 产品是什么、怎么装怎么用 → 看 [README.md](README.md)
- 怎么搭环境、构建、打包，以及必须守的红线 → 看 [CONTRIBUTING.md](CONTRIBUTING.md)
- 代码架构、模块职责、扩展点 → 就是本文

> 茶话间是一个纯内网、无服务器、基于 IP 的局域网即时通讯 + 文件传输工具。每个客户端都是对等节点，没有中心服务器，所有数据只在局域网内流动。

## 技术栈

| 领域 | 选型 | 说明 |
|---|---|---|
| 桌面框架 | **Electron 22.3.27**（精确锁死） | 最后一个支持 Windows 7 的大版本；一套二进制覆盖 Win7 → 最新系统 |
| 渲染层 | **Vue 3** + **Pinia** | 构建目标 Chrome 108 |
| 语言 | **TypeScript 5.6**（strict） | 主进程、渲染层、共享层全 TS |
| 本地存储 | **better-sqlite3 9.6**（WAL） | 项目里**唯一**的原生模块 |
| 构建 | **electron-vite 2** + **Vite 5** | 三套产物：main / preload / renderer |
| 测试 | **vitest 2** | 网络/存储/纯函数单测 + 回环集成 |
| 打包 | **electron-builder 24** | NSIS / 便携版 / deb / AppImage / dmg / zip |
| 本地 OCR | **tesseract.js 6** | 语言包本地打包，绝不联网下载 |

## 运行时基线（写代码前必懂）

整个项目焊死在 Electron 22，这直接决定了你能用什么语法：

- **主进程 / preload 按 Node 16.17 写** —— 没有全局 `fetch`、没有 `structuredClone`；网络一律用 `net` / `dgram` / `http`。
- **渲染层按 Chrome 108 写** —— 没有原生 CSS 嵌套、Popover、`text-wrap: balance`、subgrid。
- 这两条不是君子协定：构建目标已在 [`electron.vite.config.ts`](electron.vite.config.ts) 写死成 `node16` / `chrome108`，**越线的语法编译期就会失败**。

完整红线（依赖纪律、安全基线、纯内网原则、入站白名单校验等）见 [CONTRIBUTING.md「核心约束」](CONTRIBUTING.md#核心约束务必遵守)。

## 进程模型与分层

三个进程，单向依赖，渲染层永远碰不到系统能力：

```
┌─────────────────────────────────────────────┐
│ 渲染进程 (Chrome 108, Vue 3 + Pinia)          │
│   4 个 UI 入口：主窗 / 设置 / 截图 / 图片查看   │
│   只做展示与交互，状态是主进程的「投影」         │
└───────────────────┬─────────────────────────┘
                    │ 仅通过 window.pantry 调用
                    │ (preload 用 contextBridge 暴露)
┌───────────────────┴─────────────────────────┐
│ 主进程 (Node 16.17)                           │
│   net/      网络：发现、可靠消息、文件传输      │
│   store/    存储：SQLite 各 repo + 全文搜索    │
│   services/ 用例编排（把 net + store 串起来）   │
│   windows/  托盘、设置窗、截图窗、图片窗        │
│   index.ts  装配 + IPC handlers + 系统集成     │
└─────────────────────────────────────────────┘
```

**分层铁律**（违反会让代码无法单测、或破坏安全边界）：

1. `renderer/` 不 import 任何 electron / node 模块，一切能力经 `window.pantry`。
2. `net/` 与 `store/` **零 Electron 依赖、互不感知** —— 所以 vitest 能直接 `new` 出来跑，不必拉起 Electron。
3. 业务编排只在 `services/`；IPC handler 层（`index.ts` 里）只做参数校验 + 转发，**业务逻辑禁止写进去**。
4. `shared/` 零运行时依赖，只放类型和常量，主进程和渲染层都能 import。

## 目录结构

```
pantry/
├─ src/
│  ├─ shared/              # 主/渲染共享，零运行时依赖
│  │   ├─ protocol.ts      #   线上协议的 TS 定义（协议唯一事实来源）
│  │   ├─ ipc.ts           #   IPC 契约 PantryApi（window.pantry 的类型唯一来源）
│  │   ├─ pk.ts            #   「PK 分歧解决」玩法的类型与常量
│  │   └─ compat-emoji.ts  #   emoji 兼容渲染映射表
│  │
│  ├─ preload/
│  │   └─ index.ts         # contextBridge 唯一入口，把 PantryApi 挂到 window.pantry
│  │
│  ├─ main/                # 主进程（Node 16.17）
│  │   ├─ index.ts         #   装配、IPC handlers、通知/截图编排、pantry-img/pantry-sticker 自定义协议
│  │   ├─ notifications.ts #   桌面通知（emoji 文本降级、真实应用图标）
│  │   ├─ net/             #   网络层（零 Electron 依赖）
│  │   │   ├─ codec.ts         报文编解码 + 入站白名单校验
│  │   │   ├─ udp.ts           UDP 收发、广播、限速
│  │   │   ├─ discovery.ts     上线/下线/心跳、gossip、探活
│  │   │   ├─ messenger.ts     可靠消息投递（等待表 + 重发队列，按「消息×收件人」复合键）
│  │   │   ├─ transfer.ts      TCP 文件传输数据面（拉取式流、SHA-256 校验）
│  │   │   ├─ frame.ts         TCP 长消息/控制帧
│  │   │   ├─ cidr.ts          网段计算（手动 IP / CIDR 扫描）
│  │   │   ├─ peer-registry.ts 在线节点表
│  │   │   ├─ peer-clock.ts    对端时钟（消息时序）
│  │   │   └─ range-sync.ts    扫描网段在在线节点间低频同步
│  │   ├─ store/           #   存储层（零 Electron 依赖）
│  │   │   ├─ db.ts            SQLite 连接（WAL）
│  │   │   ├─ migrations.ts    迁移数组（user_version 机制，只追加、永不改旧）
│  │   │   ├─ *-repo.ts        peers / conv / msg / queue / dedup / group / transfer / sticker 各仓储
│  │   │   ├─ fts.ts           中文「按字」全文搜索
│  │   │   ├─ app-state.ts     本机身份 identity + 配置 config
│  │   │   └─ db-selftest.ts   `npm run test:db` 的入口
│  │   ├─ services/        #   用例编排层（把 net + store 串起来）
│  │   │   ├─ chat.ts          单聊
│  │   │   ├─ groups.ts        讨论组
│  │   │   ├─ files.ts         文件/文件夹传输
│  │   │   ├─ search.ts        搜索
│  │   │   ├─ forward.ts       消息转发
│  │   │   ├─ porter.ts        .pantry-bak 备份导出 / 迁移导入
│  │   │   └─ image-ocr-cache.ts  OCR 结果会话级缓存
│  │   ├─ util/            #   纯工具（零依赖、各自带 .test.ts）
│  │   │   ├─ atomic-write.ts  原子写文件
│  │   │   ├─ path-policy.ts   落盘路径策略（防路径穿越）
│  │   │   ├─ sanitize.ts      文件名/文本清洗
│  │   │   ├─ zip-store.ts     备份包 zip 打包
│  │   │   └─ renderer-url.ts  渲染入口 URL 拼装
│  │   └─ windows/         #   窗口与系统集成
│  │       ├─ tray.ts / tray-icon.ts / tray-badge.ts   托盘 + 未读角标
│  │       ├─ settings-window.ts       设置独立窗
│  │       ├─ capture-window.ts        截图框选窗
│  │       └─ image-viewer-window.ts   独立图片查看窗
│  │
│  └─ renderer/            # 渲染进程（Chrome 108，Vue 3）
│      ├─ src/
│      │   ├─ main.ts          按 location.hash 分流到 4 个根组件
│      │   ├─ App.vue          主窗（三栏：导航 / 列表 / 聊天）
│      │   ├─ SettingsApp.vue  设置窗（#/settings）
│      │   ├─ CaptureApp.vue   截图框选（#/capture）
│      │   ├─ ImageViewerApp.vue 图片查看（#/image-viewer）
│      │   ├─ stores/          Pinia：chat / groups / peers / stickers / transfers（主进程状态投影）
│      │   ├─ components/      23 个 Vue 组件（聊天面板、列表、表情、文件卡、PK 气泡……）
│      │   ├─ utils/           前端工具（emoji 测宽、剪贴板、OCR、时间、头像……）
│      │   ├─ styles/tokens.css 设计 token（颜色/字号/圆角的唯一来源）
│      │   └─ assets/          brand（品牌 logo）/ fonts / twemoji（本地 SVG 子集）
│      └─ public/ocr/      tesseract.js 的 wasm 核心 + 语言包（本地，不联网）
│
├─ build/                  # 打包资源：各平台图标、NSIS / mac 本地化配置
├─ scripts/                # 构建/发布脚本、本机多客户端联调脚本、OCR 资源准备
├─ references/             # 参考资料（ipmsg / iptux 源码本地克隆，不入库；见该目录 readme）
├─ .github/                # CI：release.yml（三平台构建 + tag 自动发版）
├─ electron.vite.config.ts # 构建配置（node16 / chrome108 目标写死在这）
└─ tsconfig*.json          # 两套类型基线：node（主进程/preload）+ web（渲染）
```

> 上面每个实现文件，旁边通常有同名的 `*.test.ts`（如 `codec.test.ts`、`messenger.test.ts`、`fts.test.ts`）。因为 `net/`、`store/`、`util/` 零 Electron 依赖，这些测试用 vitest 直接跑，不需要起 Electron。

## 典型数据流

**发一条文本消息：**

```
组件里调 window.pantry.xxx()
  → preload 转发到主进程 IPC handler (index.ts)
  → services/chat 编排：先落库 (store/msg-repo)，再交给网络
  → net/messenger 用 codec 编码，UDP+ACK 发送（超时重传；长消息走 TCP frame）
  → 主进程把「消息已入库/状态变更」事件推回渲染层
  → renderer 的 Pinia store 收到事件，更新 UI
```

**收一条消息：**

```
net/udp 收到数据包
  → codec 按白名单校验（长度/类型/字段；未知类型直接忽略，保证向前兼容）
  → discovery / messenger 分发，回 ACK
  → services 落库 + 按信封 id 去重 (store/dedup-repo)
  → 推事件给渲染层 → store 更新
```

要点：**消息 id = 信封 id = 去重锚点**；群消息用同一个信封 id 发给全体成员。文件传输是 TCP 拉取式流，发送方 offer、接收方落到指定目录（`util/path-policy` 防穿越），带 `.part` 断点续传和 SHA-256 校验。

## 二次开发：常见任务从哪改

| 你想做的事 | 改动顺序 |
|---|---|
| **加一种新消息类型** | `shared/protocol.ts` 定义 → `net/codec.ts` 加校验器 → `net/messenger.ts` / `services/` 处理 → 渲染层组件渲染。**协议永远先改 `protocol.ts`**。 |
| **加一个界面 / 组件** | `renderer/src/components/` 写组件，数据经 `window.pantry` 取；颜色字号只用 `styles/tokens.css` 的变量，不引组件库。 |
| **加一项设置** | `shared/ipc.ts` 补契约 → `preload/index.ts` 暴露 → `main/index.ts` 加 handler → `store/app-state.ts` 存配置 → `SettingsApp.vue` 加界面。 |
| **加一张表 / 字段** | `store/migrations.ts` **追加**一条迁移（绝不改旧迁移）→ 写/改对应 `*-repo.ts` → `npm run test:db` 验证迁移在真实 ABI 上跑通。 |
| **加一个独立窗口** | `main/windows/` 建窗口模块 → `renderer/src/` 加根组件并在 `main.ts` 的 hash 分流里挂上。 |
| **暴露一个新的主进程能力给前端** | 全链路都要过一遍：`shared/ipc.ts`（类型）→ `preload`（桥接）→ `main/index.ts`（handler，只校验转发）→ `services/`（真正的业务）。 |

改协议时记住：入站报文一律按不可信输入做白名单校验，未知类型**忽略而不是报错**——这是跨版本兼容的基础。

## 测试与验证

任何代码改动，交付前跑完五连验证（细节见 [CONTRIBUTING.md](CONTRIBUTING.md#提交前自测)）：

```bash
npm test          # 编解码 + 发现层回环集成 + 纯函数
npm run test:db   # 在 Electron 内置 Node 的真实 ABI 上跑迁移 / repo / FTS
npm run typecheck # node16 / chrome108 两套类型基线
npm run build     # 三端产物
npm run smoke     # 构建 + 启动 1.5s 干净退出（退出码 0）
```

网络相关测试必须绑定 `127.0.0.1`，**绝不向真实局域网发包**。本机多客户端联调（验证发现/消息/文件链路）用 `npm run dev:2` / `dev:3`，每个客户端有独立身份、数据目录和错开的端口。

## 编码约定

- **全程简体中文**：文档、注释、commit message、UI 文案。
- **依赖精确锁版本**（`npm i -E`），不跑 `npm update` / `npm audit fix --force`（会顶坏 Electron 22 基线）。
- **数据库迁移只追加**，永不修改已发布的旧迁移。
- commit 用 `feat / fix / docs / refactor / test / chore` 前缀 + 中文描述。

更细的环境坑、镜像配置、打包发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
