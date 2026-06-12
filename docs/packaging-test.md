# 茶话间平台打包与冒烟测试指南

> 给切到 Windows / Debian / macOS 后接手的 agent 或人工操作者使用。先读根目录 `AGENTS.md`，再按本文执行。

本文目标：在不同平台上稳定复现打包、安装、启动与基础收发测试，并把失败信息收集到足够可定位。当前版本：`0.5.0`，Electron 必须保持 `22.3.27`。

## 1. 总原则

- **不要改依赖版本**：禁止 `npm update`、`npm audit fix`、`npm audit fix --force`。所有依赖版本精确锁在 `package.json` / `package-lock.json`。
- **先用锁文件安装**：新环境优先 `npm ci`，不要随手 `npm install`。
- **先本地验证再打包**：每个平台打包前至少执行 `npm test`、`npm run test:db`、`npm run typecheck`、`npm run smoke`。
- **运行时纯内网**：应用本身不得访问外网；打包阶段下载 Electron / builder 二进制属于构建依赖下载，可用 `.npmrc` 镜像或提前缓存。
- **真实目标平台要测启动**：能打出包不等于可交付，必须在对应平台启动应用并过基础冒烟。
- **保留证据**：记录 commit、Node/npm 版本、系统版本、完整命令、`release/` 产物列表、失败错误原文。

## 2. 准备源码

推荐直接在目标打包机 clone 仓库。如果 VM 无法访问 Git，可以在当前机器生成 bundle 或 zip 后拷贝进去。

```bash
git rev-parse --short HEAD
git status --short
```

要求：`git status --short` 为空；记录当前 commit。

离线拷贝方式一：保留 Git 历史，适合让 agent 继续工作。

```bash
git bundle create /tmp/pantry-$(git rev-parse --short HEAD).bundle HEAD main
```

目标机器：

```bash
git clone pantry-<commit>.bundle pantry_codex
cd pantry_codex
```

离线拷贝方式二：只打包当前源码快照。

```bash
git archive --format=zip --output=/tmp/pantry-$(git rev-parse --short HEAD).zip HEAD
```

## 3. 通用验证命令

在每台打包机进入仓库后执行：

```bash
node -v
npm -v
npm ci
npm test
npm run test:db
npm run typecheck
npm run smoke
```

说明：

- 开发工具链要求 Node.js >= 18；应用运行时仍是 Electron 内置 Node 16.17.1。
- `test:db` 会用 `ELECTRON_RUN_AS_NODE=1 electron` 验证 Electron ABI 下的 better-sqlite3。
- npm 对 `.npmrc` 的 `electron_mirror/runtime/target/disturl` 警告是已知现象，不要为此修改依赖策略。

## 4. Windows 打包与 Win7 验证

### 4.1 推荐分工

- **打包机**：Windows 10/11 x64。原因是当前前端工具链需要 Node >= 18，Win7 不适合作为主要打包机。
- **验机**：Windows 7 SP1 x64 VM。用于安装、启动、收发、文件传输、通知、防火墙授权、软渲染验证。

### 4.2 Windows 打包机准备

安装：

- Git for Windows
- Node.js LTS x64，版本 >= 18
- Python 3
- Visual Studio Build Tools 2019/2022，勾选 “Desktop development with C++”

PowerShell 中执行：

```powershell
node -v
npm -v
npm ci
npm test
npm run test:db
npm run typecheck
npm run smoke
npm run dist:win
Get-ChildItem release
```

期望：

- `release/` 下出现 Windows x64 的 NSIS 安装包与 portable 产物。
- 如果只看到一个 `.exe`，先保留 electron-builder 输出和 `release/` 列表；这可能是 artifactName 冲突或 builder 命名差异，需要回代码侧确认。

### 4.3 Win7 x64 VM 冒烟

把 Windows 产物拷贝到 Win7 SP1 x64 VM。

检查：

- 首次启动不白屏、不闪退。
- Win7 防火墙弹窗出现时允许局域网访问。
- 首次启动向导可完成：昵称、公司/部门/团队、文件保存目录。
- 关于页版本显示 `0.5.0`。
- 托盘存在；关闭主窗口默认进入托盘；托盘可重新打开。
- 通知可触发；虚拟显卡下界面不花屏。

双实例回环测试可在 PowerShell 中启动第二实例：

```powershell
$env:PANTRY_USER_DATA="$env:TEMP\pantry-win7-2"
$env:PANTRY_UDP_PORT="27878"
$env:PANTRY_TCP_PORT="27879"
$env:PANTRY_PEERS="127.0.0.1:17878"
& "C:\Path\To\Pantry.exe"
```

若测试安装版，路径通常在开始菜单快捷方式属性或安装目录中查看；portable 版直接执行对应 exe。

## 5. Debian 10 打包与验证

### 5.1 推荐环境

Debian 10 x64 VM。Linux 产物建议在 Debian 10 内打包，保证 glibc 2.28 与 native 模块兼容。

基础依赖：

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates python3 make g++ pkg-config dpkg fakeroot rpm \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libfuse2
```

安装 Node.js >= 18 后执行：

```bash
node -v
npm -v
npm ci
npm test
npm run test:db
npm run typecheck
npm run smoke
npm run dist:linux
ls -lh release
```

期望产物：

- `Pantry-0.5.0-linux-x64.deb`
- `Pantry-0.5.0-linux-x64.AppImage`

### 5.2 Debian 10 冒烟

deb 安装：

```bash
sudo apt install ./release/Pantry-0.5.0-linux-x64.deb
pantry || true
```

如果没有命令行入口，使用桌面菜单启动，或查看 `/usr/share/applications/` 中的 desktop 文件。

AppImage：

```bash
chmod +x release/Pantry-0.5.0-linux-x64.AppImage
./release/Pantry-0.5.0-linux-x64.AppImage
```

检查：

- X11 环境下可启动；Wayland 只作为降级场景记录，不作为首版硬门槛。
- 首次启动向导可完成。
- 托盘/通知在当前桌面环境可用；若桌面环境不支持托盘，记录环境名称和表现。
- 文件传输可在本机双实例或两台 VM 间完成。

双实例回环：

```bash
PANTRY_USER_DATA=/tmp/pantry-debian-2 \
PANTRY_UDP_PORT=27878 \
PANTRY_TCP_PORT=27879 \
PANTRY_PEERS=127.0.0.1:17878 \
./release/Pantry-0.5.0-linux-x64.AppImage
```

## 6. macOS 打包与验证

macOS 主要用于当前架构包验证；universal 包留专项。

```bash
node -v
npm -v
npm ci
npm test
npm run test:db
npm run typecheck
npm run smoke
npm run dist:mac
ls -lh release
```

期望：

- `dmg`
- `zip`

冒烟：

- 未签名应用如被系统拦截，在“系统设置 → 隐私与安全性”允许，或对测试产物执行 `xattr -dr com.apple.quarantine <App路径>`。
- 截图功能需要屏幕录制权限；首次失败时记录系统权限提示，不要误判为应用崩溃。
- 通知权限需要手动允许。

## 7. 基础功能冒烟清单

每个平台至少过以下动作：

1. 启动应用，完成首次启动向导。
2. 打开设置页，确认资料、头像、主题、字体缩放、通知、快捷键、端口显示正常。
3. 两实例互相发现：同网段广播或 `PANTRY_PEERS` 手动指定。
4. 单聊短文本发送成功。
5. 发送一条超过 800 字节但不超过 4096 字节的长文本，确认走 TCP 控制帧后对端收到。
6. 发送图片或小文件，确认进度、完成状态、打开所在目录可用。
7. 中断一次接收后重试，确认 `.part` 断点续传能继续。
8. 建讨论组，发送群文本，测试 `@` 提醒。
9. 右键消息转发到另一会话。
10. 截图框选并使用矩形/箭头/文字/马赛克标注后发送或复制。
11. 导出 HTML/TXT 与 `.pantry-bak`，再导入到新数据目录，确认消息与图片/表情媒体可查看。
12. 关闭主窗口进入托盘，再从托盘恢复。

## 8. 失败信息收集模板

打包失败时，请保存以下信息：

```text
平台：
系统版本：
CPU/架构：
commit：
node -v：
npm -v：
执行命令：
失败阶段：npm ci / test / test:db / typecheck / smoke / dist
错误原文：
release 目录列表：
是否修改过依赖：
```

运行失败时，额外记录：

```text
产物类型：installer / portable / deb / AppImage / dmg / zip
启动方式：
是否首次启动：
是否有防火墙/权限弹窗：
是否白屏/闪退/托盘不可见：
是否能打开开发者工具或日志：
复现步骤：
截图或录屏：
```

## 9. GitHub Actions 自动构建发布

仓库内置 `.github/workflows/release.yml`：

- push 到 `main` 或手动 `workflow_dispatch`：执行 Windows + Linux 两个平台构建，产物作为 Actions artifact 下载。
- push `v*` tag：构建通过后自动创建/更新 GitHub Release，并上传产物与 SHA-256 清单。
- Linux job 使用 `node:18-buster` / Debian 10 容器，apt 指向 archive 源，重新编译 better-sqlite3，输出 `Pantry-<version>-linux-x64.deb` 与 `Pantry-<version>-linux-x64.AppImage`，同一套产物作为 Debian 10 / UOS 20 x64 发布候选。
- Windows job 使用 `windows-2022` runner 打包 Electron 22 x64，输出 `Pantry-<version>-win-x64-setup.exe` 与 `Pantry-<version>-win-x64-portable.exe`。这只能证明构建链路，不替代 Win7 SP1 x64 VM 启动冒烟。

手动触发：

```bash
gh workflow run release.yml --repo skyjt/pantry_codex
```

正式发布：

```bash
git tag v0.5.0
git push origin v0.5.0
```

Release 下载后仍需按本文 §4 / §5 在 Win7 SP1 x64、Debian 10、UOS 20 x64 目标环境做真实桌面冒烟。

## 10. 给 agent 的开场指令

### Windows 打包 agent

```text
你在 /path/to/pantry_codex 工作。先读 AGENTS.md、docs/handoff.md、docs/packaging-test.md。
目标：在 Windows x64 打出茶话间 0.5.0 的 Windows 产物，并记录可交付证据。
禁止 npm update、npm audit fix、升级 electron 或依赖。
按 docs/packaging-test.md 执行 npm ci、npm test、npm run test:db、npm run typecheck、npm run smoke、npm run dist:win。
最后汇报系统版本、Node/npm 版本、commit、命令结果、release 产物列表；如失败，保留完整错误原文并定位到阶段。
```

### Debian 10 打包 agent

```text
你在 /path/to/pantry_codex 工作。先读 AGENTS.md、docs/handoff.md、docs/packaging-test.md。
目标：在 Debian 10 x64 内打出 deb 和 AppImage，并做启动冒烟。
禁止 npm update、npm audit fix、升级 electron 或依赖。
按 docs/packaging-test.md 安装系统依赖，执行 npm ci、npm test、npm run test:db、npm run typecheck、npm run smoke、npm run dist:linux。
最后汇报系统版本、Node/npm 版本、commit、命令结果、release 产物列表、deb/AppImage 启动结果；如失败，保留完整错误原文。
```

### Win7 验证 agent

```text
你在 Win7 SP1 x64 VM 中验证茶话间 Windows 产物。
目标不是改代码，而是安装/运行/冒烟，记录兼容性问题。
按 docs/packaging-test.md 的 Win7 冒烟清单检查启动、托盘、通知、防火墙、软渲染、双实例收发、文件传输、导入导出。
如失败，记录产物文件名、启动方式、错误弹窗、截图和复现步骤。
```
