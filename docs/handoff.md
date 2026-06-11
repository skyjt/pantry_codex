# 茶话间（Pantry）开发交接文档

> 给接手本项目的任何 AI 代理或开发者。读完本文 + [AGENTS.md](../AGENTS.md) 即可无缝继续开发。
> 最后更新：2026-06-11（v0.3 里程碑收官后）。**本文描述"当前状态与下一步"，会过期——以 `git log` 与各文档变更记录为准。**

## 0. 必读顺序（15 分钟上手）

1. **[AGENTS.md](../AGENTS.md)** —— 9 条硬性红线（Electron 22.3.27 焊死、纯内网、分层铁律等），违反即错误；
2. 本文 —— 状态、工作流、下一步；
3. 设计四件套（按需细读）：[requirements.md](requirements.md)（功能与 22 项决议）→ [protocol.md](protocol.md)（线上协议 v0.11）→ [ui-design.md](ui-design.md)（界面）→ [tech-design.md](tech-design.md)（选型/分层/库表）；
4. `git log --oneline` —— 19 个提交就是完整开发史，每条 commit message 都是一份增量说明。

## 1. 项目状态一览

纯内网、无服务器、基于 IP 的局域网 IM + 文件传输（Electron 22 / Vue 3 / better-sqlite3）。
**v0.1、v0.2、v0.3 三个里程碑已完成**（对照 tech-design §12）：

| 已交付 | 说明 |
|---|---|
| 发现层 | UDP 广播 + 心跳（30s/90s）+ 探活；跨网段三板斧：手动 IP / CIDR 扫描 / gossip（结识即交换+周期）|
| 单聊 | 文本 UDP+ACK 退避重传、离线补发队列（落库）、24h 去重、打开会话二次探活 |
| 讨论组 | LWW 元数据（rev+updatedTs）、同一信封逐成员扇出、need/info 补元数据、任何成员可管理 |
| 文件 | TCP 拉取式流传输、SHA-256 流式校验、文件夹递归、重名避让、路径穿越防护 |
| 图片/表情 | offer purpose=image/sticker，≤20MB 免确认；截图粘贴/拖图；右键收藏（canvas 压缩 512px WebP）|
| 内置截图 | 全局快捷键 Ctrl/Cmd+Alt+A、框选窗、剪贴板+直发会话、截图隐藏主窗（可配）|
| UI | 三栏主窗、三级通讯录树（公司▸部门▸团队）、资料卡+本地备注、全局搜索（FTS 按字）、历史滚动加载、设置独立小窗、首启向导、托盘+通知直达会话 |
| 存储 | SQLite WAL，迁移 v5（user_version 机制，**只追加永不改旧迁移**）|

## 2. 开发工作流（沿用即可）

**一个增量 = 设计文档同步 → 实现 → 五连验证 → 一个中文 commit**：

```bash
npm test          # vitest 35 例：codec/discovery/messenger/transfer/frame/sanitize/cidr/fts
npm run test:db   # 数据库自测：ELECTRON_RUN_AS_NODE 在真实 ABI(110) 上跑迁移/各 repo
npm run typecheck # node16 + chrome108 双基线
npm run build     # 三端产物
npm run smoke     # 启动 1.5s 干净退出（PANTRY_SMOKE 钩子，CI 同款）
```

- 本机双实例联调：`PANTRY_USER_DATA=/tmp/pantry-dev2 PANTRY_UDP_PORT=27878 PANTRY_PEERS=127.0.0.1:17878 npm run dev`
- 决策落档：新决议追加到 requirements §9（编号已到 #22，续 #23+）+ 涉及文档的变更记录；协议改动必须 protocol.md 先行。
- 与用户协作：**全程中文**；用户技术方向不在网络/协议——技术细节直接定但落档、**不要追问底层**；产品可感知取舍（功能形态/默认参数）用 2-4 个带推荐的选项问他。

## 3. 代码地图（src/，分层铁律见 AGENTS.md #7）

```
shared/    protocol.ts(协议TS化·唯一来源) ipc.ts(IPC契约·唯一来源) 
main/
  net/     codec(校验白名单) udp(限速/广播) discovery(发现/gossip/探活)
           messenger(可靠投递·等待表与队列按"消息×收件人"复合键) transfer(TCP数据面) frame cidr
  store/   db(WAL) migrations(v5·只追加) peers/conv/msg/queue/dedup/group/transfer/sticker-repo
           fts(中文按字) app-state(identity/config) db-selftest(test:db 入口)
  services/ chat groups files search —— 用例编排层；业务禁入 ipc 层（AI 接口预留，决议#21）
  windows/ tray settings-window capture-window tray-icon(base64内嵌)
  index.ts 装配+IPC handlers+通知+截图编排+pantry-img/pantry-sticker 协议
preload/   contextBridge 唯一入口（window.pantry，类型=shared/ipc.ts 的 PantryApi）
renderer/  main.ts 哈希三入口(App/#settings/#capture)；stores(pinia=主进程投影)；components
```

关键不变量：net/ 与 services/ **零 Electron 依赖**（vitest 可直接实例化）；renderer 一切经 `window.pantry`；消息 id=信封 id=去重锚点；群消息同一信封 id 发全员。

## 4. 下一步：v0.4（按此顺序做）

1. **消息撤回**（F-MSG-6）：自己的消息 2 分钟内可撤；协议建议新增 `msg.kind:"recall"`（payload 带 `targetId`）或独立 type——**先改 protocol.md 留痕**；对端删除消息行+插系统提示行；离线对端随补发送达；UI 右键菜单已有占位（ChatPane 注释 P1）。
2. **断点续传**（F-FILE-4）：数据面已预留——`pull` 帧带 `offset`、发送端支持任意 offset、`done` 是整文件哈希；要做的是接收端保留 `.part`+已收字节数（transfers 表加列→迁移 v6）、失败后重连续拉、UI 加"继续"按钮。
3. **聊天导出/导入**（决议 #19）：`services/porter.ts`；阅读格式 HTML/TXT + 迁移备份包 `.pantry-bak`（zip 容器：manifest/messages.jsonl/media）。**zip 选型未定**：Node 16 无内置 zip，建议纯 JS 的 `yazl`+`yauzl`（engines 兼容，需精确锁版本过五连）或自写 store-only zip；导入身份映射规则见 tech-design §8。
4. **深色主题**：tokens.css 变量化已就绪，加一套暗色表+设置开关（config 持久化）。

之后 **v1.0**：electron-builder 配置（`electronVersion: 22.3.27`、`asarUnpack` better-sqlite3、win x64 NSIS+便携/deb+AppImage/dmg+zip universal）、GitHub Actions（**linux 必须 debian:10 容器**编译 native）、三平台冒烟清单、**Win7 VM 专项**（twemoji 图片渲染落地、软渲染验证、SHA-2 KB 提示文案）、LICENSE 定稿（暂定 MIT，需用户确认）。

## 5. 已知遗留 / TODO（非阻塞）

- emoji 当前用系统字形渲染；**twemoji 子集图片替换**（Win7 彩色方案，tech-design §7）留待 Win7 冒烟时做（纯展示层，协议无关）。
- 群内暂不支持文件/图片/表情包（传输是单目标的；UI 已禁用并提示"后续版本"）。
- 群消息不做按成员送达回执（本端入库即 sent），明细 P2。
- 设置页待补：截图快捷键自定义、聊天记录存储位置迁移、导出入口（随 v0.4 porter 加）、字体缩放。
- npm 11 对 `.npmrc` 自定义键（electron_mirror/runtime 等）打 deprecation 警告——npm 12 需改用环境变量，暂可忽略。
- linux arm64 产物：CI 用 docker buildx，拖节奏就先只发 x64（tech-design §9 已记）。
- 协议 `profile.ver` 已传输，"发现内网新版本提示"（P2）尚未做 UI。

## 6. 环境与坑（新机器上手）

- 开发机 Node ≥18（仅工具链；运行时是 Electron 内置 Node 16.17，**主进程代码无 fetch/structuredClone**）。
- `npm install` 后 Electron 报损坏 → README「常见问题」的 ditto 解法（macOS 解压坑）。
- `.npmrc` 三件套**都是故意的，不要"修"**：`legacy-peer-deps`（@types/node 锁 16）、`runtime=electron`+`target`（native 模块面向 Electron ABI 编译，开发机 Node 太新会编不过 9.x 源码）。
- 网络相关测试必须 `bindAddress: '127.0.0.1'` + `broadcastTargets: []`——**绝不向真实局域网发包**。
- 数据库迁移只追加（migrations.ts 数组 push 新项）；建新表前检查是否已存在于早期迁移（groups/stickers/transfers 都吃过"漏建表"的亏，db-selftest 会抓）。
