<div align="center">

<img src="build/icons/pantry-logo-icon.svg" alt="茶话间 Logo" width="120" height="120" />

<h1>茶话间 &nbsp;·&nbsp; Pantry</h1>

<p><b>纯内网、基于 IP 的局域网即时通讯与文件传输工具</b></p>

<p>
  <a href="https://github.com/skyjt/pantry_codex/releases/latest">
    <img src="https://img.shields.io/github/v/release/skyjt/pantry_codex?style=flat-square&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=3D8B6B&logo=github&logoColor=white" alt="最新版本" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-3D8B6B?style=flat-square" alt="MIT License" />
  </a>
  <a href="https://github.com/skyjt/pantry_codex/releases">
    <img src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%207%2B%20%7C%20Linux%20%7C%20macOS-0366d6?style=flat-square" alt="平台" />
  </a>
  <img src="https://img.shields.io/badge/Electron-22-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron 22" />
</p>

<p>
  <a href="#特性">特性</a>
  &nbsp;·&nbsp;
  <a href="#平台支持">平台支持</a>
  &nbsp;·&nbsp;
  <a href="#安装">安装</a>
  &nbsp;·&nbsp;
  <a href="#使用">使用</a>
  &nbsp;·&nbsp;
  <a href="#工作原理">工作原理</a>
  &nbsp;·&nbsp;
  <a href="#安全性">安全性</a>
  &nbsp;·&nbsp;
  <a href="#参与开发">参与开发</a>
</p>

</div>

---

**茶话间**是一款面向**纯内网环境**的桌面聊天与文件传输工具——不依赖互联网，不依赖任何中心服务器。启动后自动发现同一局域网内的其他在线用户，即可收发消息、互传文件。所有数据只在内网中流动，适合办公内网、隔离网络、实验室等不便或不允许连接外网的场景。

> 产品形态参考内网通、飞秋（FeiQ）、IP Messenger（ipmsg）、iptux。

## 特性

- **零配置、零服务器** —— 基于 UDP 广播自动发现在线用户，节点之间对等（P2P）直连，无需架设任何服务端。
- **消息聊天** —— 单聊与讨论组，支持文本、图片、表情、截图粘贴；送达确认、离线暂存补发、消息撤回、转发、群内 @；历史本地存储，可导出与迁移。
- **文件传输** —— TCP 点对点直连，跑满内网带宽；支持文件 / 文件夹、拖拽发送、断点续传、传输记录。
- **纯内网** —— 不访问外网、无遥测上报、不自动检查更新，默认关闭一切联网行为。
- **老设备友好** —— 最低支持 Windows 7 SP1 / Debian 10 / macOS，兼顾老旧设备与国产化环境。
- **跨平台** —— Windows、Linux、macOS 一套体验。

## 平台支持

| 平台 | 最低版本 | 架构 | 分发形式 |
|---|---|---|---|
| Windows | 7 SP1（含 8 / 8.1 / 10 / 11），仅 64 位 | x64 | NSIS 安装包、便携版 |
| Linux | Debian 10（buster）及衍生发行版（含 UOS / 统信） | x64、arm64 | .deb、AppImage |
| macOS | 26（Tahoe）及以上 | arm64 / x64（universal） | .dmg、.zip |

> 为同时支持 Windows 7 与较老的 Linux，应用基于 **Electron 22** 构建——它是最后一个支持 Win7 的大版本，一套二进制即可覆盖全部目标平台。相关约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安装

前往 [**Releases**](https://github.com/skyjt/pantry_codex/releases) 下载对应平台的安装包。

**Windows** — 运行 NSIS 安装包，或解压便携版直接使用。Windows 7 需为 **SP1 且 64 位**；若启用了代码签名，未打补丁的 Win7 需先安装系统更新 KB4474419。

**Linux** — `.deb` 适用于 Debian / Ubuntu / UOS 等；其他发行版可用 `AppImage`（`chmod +x` 后运行）。

**macOS** — 打开 `.dmg` 拖入「应用程序」。内网分发若未签名 / 公证，首次打开需在「系统设置 → 隐私与安全性」中允许，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/茶话间.app
```

## 使用

1. 同一局域网内的设备各自启动茶话间，会**自动相互发现**并出现在用户列表中。
2. 点击用户即可开始单聊，或新建讨论组群聊；把文件拖入聊天窗即可发送。
3. **跨网段**时 UDP 广播通常不可达，可在设置中手动添加对端 IP，或指定网段探测。
4. 首次运行时操作系统防火墙可能提示放行端口，请允许（默认 UDP / TCP `17878` / `17879`）。

## 工作原理

每个客户端都是对等节点，整个系统**没有服务器**：

```
渲染进程（UI）—— 用户列表 / 聊天窗 / 文件传输列表
   │  仅通过 contextBridge 暴露的 IPC 与主进程通信
主进程
   ├─ 网络层：UDP 发现与心跳、UDP+ACK / TCP 消息通道、TCP 文件传输
   ├─ 存储层：SQLite（消息历史、联系人、传输记录）
   └─ 系统集成：托盘、桌面通知、开机自启
```

| 通道 | 传输方式 | 默认端口 | 用途 |
|---|---|---|---|
| 发现 | UDP 广播 | 17878 | 上线 / 下线广播、在线应答、心跳 |
| 消息 | UDP + ACK 重传，长消息走 TCP | 17878 / 17879 | 文本消息、状态变更 |
| 文件 | TCP 直连 | 17879 | 文件 / 文件夹传输，分块 + 校验 |

协议思路参考 IP Messenger（上线广播 → 各端应答以建立在线列表），但不直接兼容老协议。

## 安全性

- **网络边界** —— 所有通信仅发生在局域网内；应用不访问外网、不上报任何数据、不自动检查更新。
- **最小攻击面** —— 渲染进程只加载本地资源、永不加载远程网页；开启 `contextIsolation` + `sandbox`、关闭 `nodeIntegration`；拦截一切窗口内导航与 `window.open`；严格 CSP；所有来自网络的报文都按不可信输入做白名单校验。
- **文件接收** —— 仅落到用户指定目录，文件名做清洗（防路径穿越），不做覆盖式写入。
- **不做传输层加密** —— 信任内网边界，沿用 ipmsg / iptux 的明文做法。如需机密性，请在受信任的网络中使用。

## 参与开发

欢迎参与。源码构建、开发约定与本机联调说明见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

如遇问题或有功能建议，请在 [Issues](https://github.com/skyjt/pantry_codex/issues) 提交。

## 参考项目

- [IP Messenger](https://ipmsg.org/) — ipmsg，内网 IM 协议鼻祖
- [iptux](https://github.com/iptux-src/iptux) — Linux 下的 ipmsg 兼容实现
- 飞秋（FeiQ）、内网通 — Windows 平台流行的内网 IM，产品形态参考

## 第三方资源

内置头像与 emoji 兼容渲染使用 [Twemoji](https://github.com/jdecked/twemoji) SVG 图形子集（本地打包，CC-BY 4.0）。完整声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

[MIT](LICENSE) © 2026 skyjt
