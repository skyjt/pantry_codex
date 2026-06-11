# 茶话间（Pantry）

> 纯内网、基于 IP 的局域网即时通讯与文件传输工具

**茶话间**（英文名 Pantry，与仓库目录名一致）是一款面向**纯内网环境**的聊天软件：不依赖互联网、不依赖中心服务器，启动后自动发现同一局域网内的其他在线用户，进行消息聊天与文件传输。所有数据只在内网中流动，适合办公内网、隔离网络、实验室等场景。

产品形态参考：**内网通、飞秋（FeiQ）、IP Messenger（ipmsg）、iptux**。

**项目状态：v0.4.0 首个可交付预览版准备中**。v0.1–v0.3 里程碑已落地，v0.4 已完成文本/群文本消息撤回；Windows 与 Debian 的真实打包运行测试放在最终交付前由目标平台执行。进度以 `git log` 为准，里程碑规划见 [docs/tech-design.md](docs/tech-design.md) §12。

## 核心特性（规划）

- **零配置、零服务器**：基于 UDP 广播自动发现在线用户，节点之间对等（P2P）通信，无需架设任何服务端
- **消息聊天**：单聊/讨论组、文本/图片/表情包/截图粘贴，送达确认与离线暂存补发，消息历史本地存储（可导出/导入迁移）
- **文件传输**：TCP 点对点直连，跑满内网带宽；支持文件/文件夹、拖拽发送、断点续传（规划）
- **纯内网**：不访问外网、无遥测上报，默认关闭一切联网行为（包括更新检查）
- **老设备友好**：最低支持 Windows 7 / Debian 10 / macOS 26

## 平台支持

| 平台 | 最低版本 | 架构 | 分发形式 |
|---|---|---|---|
| Windows | 7 SP1（含 8 / 8.1 / 10 / 11），仅 64 位 | x64 | NSIS 安装包、便携版 |
| Linux | Debian 10（buster，glibc 2.28）及衍生发行版 | x64、arm64 | .deb、AppImage |
| macOS | 26（Tahoe）+ | arm64、x64（universal 包） | .dmg、.zip |

补充说明：

- Windows 7 必须为 SP1 **且为 64 位**——已决议不支持 32 位系统，不出 ia32 包；如果发行版本启用代码签名（SHA-2），未打补丁的 Win7 需先安装 KB4474419。
- macOS 26 是支持 Intel 机型的最后一代 macOS，因此提供 universal 包同时覆盖 Apple Silicon 与 Intel。Electron 22 本身可以运行在更老的 macOS（10.13+）上，但本项目只以 macOS 26 为测试与支持基线。
- 新版 macOS 对未签名应用管控严格，内网分发若不做签名/公证，需在「系统设置 → 隐私与安全性」中手动允许，或 `xattr -dr com.apple.quarantine` 去除隔离属性；正式分发建议配代码签名。
- Debian 10 官方支持已结束，这里仅作为运行环境下限，不代表推荐。

## 技术选型：Electron 22（焊死）

**Electron 锁定 `22.3.27`（22.x 的最终版本），不升级、不浮动。**

原因：自 Electron 23（Chromium 110）起官方放弃了 Windows 7 / 8 / 8.1，**Electron 22 是最后一个支持 Win7 的大版本**；同时它对 glibc 的要求也能覆盖 Debian 10。一套二进制覆盖全部目标平台，不做新旧双构建，把兼容测试和发布成本压到最低。

Electron 22 的内核组件即本项目的运行时基线：

| 组件 | 版本 | 决定了什么 |
|---|---|---|
| Chromium | 108 | 渲染进程 JS / CSS / Web API 的能力上限 |
| Node.js | 16.17.1 | 主进程与 preload 的 API 上限 |
| V8 | 10.8 | ES2022 语法可用 |

### 开发红线（必须遵守）

1. **`electron` 永远精确锁定 `22.3.27`**：`package.json` 中不写 `^`/`~`，lockfile 必须提交。
2. **渲染进程以 Chrome 108 为基线**（构建目标设为 `chrome108`）：
   - ✅ 可用：ES2022、`:has()`、容器查询、`<dialog>`、`structuredClone`
   - ❌ 不可用：原生 CSS 嵌套（112+）、Popover API（114+）、`text-wrap: balance`（114+）、subgrid（117+）
3. **主进程以 Node 16.17 为基线**（构建目标设为 `node16`）：
   - ❌ 无全局 `fetch`（Node 18+）、无 `structuredClone`（Node 17+）；网络相关一律用 `net` / `dgram` / `http` 模块
4. **第三方依赖必须兼容 Node 16**：留意包的 `engines` 声明（很多包新版本已要求 Node ≥ 18）；所有依赖锁定精确版本，任何升级都要过三平台冒烟测试。
5. **原生模块**（如 better-sqlite3）必须用 `@electron/rebuild` 针对 Electron 22 的 ABI 重新编译，并选用仍支持 Node 16 的版本。
6. Electron 22 已于 2023-10 停止维护（EOL），**不再有安全补丁**——对应的缓解策略见下文「安全性」。

## 架构概览

```
渲染进程（UI）
  └─ 用户列表 / 聊天窗 / 文件传输列表
     （仅通过 contextBridge 暴露的 IPC 与主进程通信）

主进程
  ├─ 网络层：UDP 发现与心跳、UDP+ACK / TCP 消息通道、TCP 文件传输
  ├─ 存储层：SQLite（消息历史、联系人备注、传输记录）
  └─ 系统集成：托盘、桌面通知、开机自启

每个客户端都是对等节点，整个系统没有服务器。
```

### 网络协议（草案 v0）

> 报文格式与时序的详细设计见 [docs/protocol.md](docs/protocol.md)（协议的唯一事实来源），本节仅为概览。

| 通道 | 传输方式 | 默认端口 | 用途 |
|---|---|---|---|
| 发现 | UDP 广播（子网定向广播 + 255.255.255.255） | 17878 | 上线/下线广播、在线应答、心跳 |
| 消息 | UDP + ACK 重传；长消息走 TCP | 17878 / 17879 | 文本消息、状态变更 |
| 文件 | TCP 直连 | 17879 | 文件/文件夹传输，分块 + 校验 |

- 报文为带 `version` 字段的 JSON（UTF-8）。协议思路参考 IPMSG（上线广播 → 各端应答，借此建立在线列表；协议原文见 `references/ipmsg/protocol.txt`），但**不直接兼容** IPMSG / 飞秋——老协议文本编码混乱（SJIS / GBK / UTF-8 扩展并存）、各家扩展互不兼容。与飞秋 / ipmsg 互通作为后续「兼容模式」规划（可选开关，监听 2425 端口）。
- 端口可配置。跨网段时广播不可达，规划支持手动添加对端 IP / 指定网段定向探测。
- 防火墙需放行上述端口的入站流量（Windows 首次运行会弹出防火墙授权）。

## 功能规划

> 详细需求、优先级与决议记录见 [docs/requirements.md](docs/requirements.md)（功能需求的唯一事实来源），以下仅为概览。主场景定位：**中大型办公内网**（多网段，≤1000 在线节点）。

- **v0.1（MVP）**：同网段自动发现 + 手动添加 IP、单聊文本（送达状态、离线暂存补发）、托盘与桌面通知、三栏主窗 UI（导航 / 列表 / 聊天，参考微信，见 docs/ui-design.md）
- **v0.2**：文件/文件夹传输（确认/自动接收策略）、图片消息（截图粘贴）、消息历史与搜索
- **v0.3**：讨论组（群聊）、内置截图、自定义表情包、跨网段发现（网段扫描 + 节点列表交换）、三级分组树（公司▸部门▸团队）
- **v0.4+**：消息撤回、断点续传、聊天记录导出/导入、深色主题
- **远期**：IPMSG / 飞秋兼容模式、多语言（默认 zh-CN）、共享文件柜 / 远程协助 / 语音对讲（评估）、本地开放接口（AI 读取/接管聊天，默认关闭、仅本机）

## 目录结构（约定，待脚手架落地）

```
pantry/
├─ src/
│  ├─ main/        # 主进程：net/（发现、传输、协议编解码）、store/（SQLite）、tray 等
│  ├─ preload/     # contextBridge 安全桥，渲染进程唯一的能力入口
│  ├─ renderer/    # UI（Vue 3 + Pinia，构建目标 chrome108）
│  └─ shared/      # 主/渲染进程共享的类型与常量（协议定义等）
├─ build/          # 打包资源（图标、安装器配置）
├─ docs/           # 协议与设计文档
├─ references/     # 参考资料与开源项目源码（ipmsg、iptux），见该目录下 readme
└─ scripts/        # 构建 / 发布脚本
```

## 开发

> 脚手架尚未初始化，以下为约定；技术选型与模块设计见 [docs/tech-design.md](docs/tech-design.md)。

环境要求：

- Node.js ≥ 18（仅供工具链使用，Vite 5 要求；应用运行时是 Electron 内置的 Node 16.17.1，与本机 Node 版本无关）
- 国内网络建议配置 Electron 镜像（项目 `.npmrc`）：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

常用脚本：

```bash
npm run dev          # 本地开发（热重载）
npm run build        # 编译 main / preload / renderer
npm test             # vitest：协议编解码 + 发现层回环集成 + 纯函数
npm run test:db      # 数据库自测（在 Electron 内置 Node 真实 ABI 上执行）
npm run typecheck    # node16 / chrome108 两套类型基线
npm run smoke        # 构建 + 启动冒烟（1.5s 干净退出）
npm run dist:win     # NSIS 安装包 + 便携版（x64；请在 Windows/Win7 VM 测试）
npm run dist:linux   # deb + AppImage（x64；请在 Debian 10 环境测试）
npm run dist:mac     # dmg + zip（当前 macOS 架构；正式 universal 包后续专项）
```

本机双实例联调（验证发现/消息链路，不需要两台机器）：

```bash
# 终端 1：默认端口
npm run dev
# 终端 2：独立数据目录（独立身份）+ 错开端口 + 手动指向终端 1
PANTRY_USER_DATA=/tmp/pantry-dev2 PANTRY_UDP_PORT=27878 PANTRY_PEERS=127.0.0.1:17878 npm run dev
```

### 常见问题

- **macOS 上报 `Electron failed to install correctly`**：解压环节对 zip 内符号链接处理失败（实测于 npm 11 / Node 24）。处理：进入 `node_modules/electron`，用系统 `ditto -xk ~/Library/Caches/electron/<哈希目录>/electron-v22.3.27-darwin-arm64.zip dist/` 手动解压，再执行 `printf "Electron.app/Contents/MacOS/Electron" > path.txt`（**必须用 printf，路径不能带换行**）。

## 安全性

- **网络边界**：所有通信仅发生在局域网内；应用不访问外网、不上报任何数据、不自动检查更新。
- **EOL 内核的风险缓解**：Electron 22 不再有安全补丁，因此从架构上消除攻击面——
  - 永不加载远程网页内容，渲染进程只加载本地资源；
  - 开启 `contextIsolation` + `sandbox`，关闭 `nodeIntegration`；
  - 禁用 `webview`，拦截一切窗口内导航与 `window.open`；
  - 严格 CSP；所有来自网络的报文一律按不可信输入校验（长度、类型、字段白名单）。
- 文件接收只落到用户指定目录，文件名做清洗（防路径穿越），不做覆盖式写入。
- 不做传输层加密：信任内网边界，沿用 ipmsg / iptux 的明文做法（已定决策，见 docs/requirements.md 决议 #5）。

## FAQ

**为什么不用新版 Electron，再给 Win7 单独维护一个旧版（双构建）？**
双构建意味着双倍的兼容测试与发布流程。本项目功能边界明确（IM + 文件传输），Chromium 108 / Node 16 的能力完全够用，单一版本是更省的选择。未来确有需要再评估「modern 通道」。

**为什么不直接兼容飞秋 / ipmsg 协议？**
IPMSG 协议历史包袱重：文本编码不统一、各客户端扩展互不兼容。先把自有协议做干净，互通作为可选兼容模式后置。

**macOS 26 上跑 Chromium 108 这种老内核稳吗？**
这是已知风险项（输入法、渲染、系统权限弹窗等行为可能有差异），列入每次发布前的三平台冒烟清单，需真机实测验证。

## 参考项目

- [IP Messenger](https://ipmsg.org/)（ipmsg，协议鼻祖，源码在 `references/ipmsg/`）
- [iptux](https://github.com/iptux-src/iptux)（Linux 下的 ipmsg 兼容实现，源码在 `references/iptux/`）
- 飞秋（FeiQ）、内网通 —— Windows 平台流行的内网 IM，产品形态参考

## License

暂定 MIT（正式发布前确认）。
