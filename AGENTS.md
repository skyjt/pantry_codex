# 茶话间（Pantry）—— AI 代理通用约束

任何 AI 代理/自动化工具在本仓库工作前必读。本项目是纯内网、无服务器、基于 IP 的局域网 IM + 文件传输工具（Electron）。

## 文档体系（先读文档，改设计先改文档）

| 文档 | 职责（各自是该领域的唯一事实来源） |
|---|---|
| `docs/handoff.md` | **接手必读**：当前状态、工作流、代码地图、下一步任务分解 |
| `README.md` | 项目定位、平台矩阵、**Electron 22 焊死与开发红线**、常见问题 |
| `docs/requirements.md` | 功能需求、优先级、**决议记录（#1–#22，持续递增）** |
| `docs/protocol.md` | 线上协议：报文、时序、常量 |
| `docs/ui-design.md` | 三栏布局、交互流程、视觉 token |
| `docs/tech-design.md` | 选型、模块分层、库表、风险对策 |

**流程铁律**：任何设计变更先改对应文档（决议记录编号递增 + 变更记录留痕），再动代码。不在文档里的功能不要写代码。

## 硬性红线（违反即错误，没有例外）

1. **`electron` 永远精确锁 `22.3.27`**。不升级、不加 `^`/`~`。这是为支持 Win7 的根决策，整个项目因它存在。
2. **运行时基线**：主进程 = Node 16.17（**无全局 `fetch`、无 `structuredClone`**）；渲染层 = Chrome 108（**无原生 CSS 嵌套/Popover/`text-wrap: balance`/subgrid**）。构建目标已在 `electron.vite.config.ts` 写死为 `node16`/`chrome108`，不许放宽。
3. **依赖纪律**：所有依赖精确锁版本（`npm i -E`）；**永不运行 `npm update`**；新增依赖先查 `engines` 是否兼容 Node 16、是否含 native 模块（native 只允许 better-sqlite3 一个）。`@types/node` 锁 16.x、`.npmrc` 的 `legacy-peer-deps` 都是故意的（文件内有注释），不要"修复"。
4. **安全基线不可动**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`will-navigate` 拦截、`setWindowOpenHandler` deny、严格 CSP。渲染进程永不加载远程内容。
5. **纯内网原则**：不引入任何外网请求（更新检查、统计上报、CDN 字体、远程图片、第三方 API 一律禁止）。这是产品命门，也适用于构建产物。
6. **日志脱敏**：消息正文、文件内容永不写入日志，只记元数据（消息 ID、类型、长度、节点 ID）。
7. **分层铁律**（`src/` 结构）：
   - `renderer/` 不 import electron/node 模块，一切能力经 `window.pantry`（preload contextBridge）；
   - `ipc/` 层只做参数校验与转发，**业务逻辑禁入**（为远期 AI 本地接口预留并列前台，决议 #21）；
   - `net/`、`store/` 互不感知、且**零 Electron 依赖**（保证 vitest 可直接实例化），编排在 `services/`；
   - `shared/` 零运行时依赖，只放类型与常量。
8. **协议改动顺序**：`docs/protocol.md`（留变更记录）→ `src/shared/protocol.ts` → `codec.ts` 校验器 → 补测试。入站报文一律白名单校验；未知报文类型忽略不报错（向前兼容）。
9. **非目标不许"顺手"实现**：传输/存储加密、任何形式的服务器、已读回执、富文本、视频通话、IPMSG 线上互通（远期另议）。完整清单见 requirements §3。

## 代码与提交约定

- TypeScript strict；文档、注释、commit message、UI 文案一律简体中文。
- UI 遵循 `docs/ui-design.md`：颜色/字号/圆角只用 `tokens.css` 的 CSS 变量、圆形头像、茶青主色 `#3D8B6B`、不引入组件库；离线展示必须灰显 + "离线"副文字（决议 #17）。
- commit：`feat/fix/docs/refactor/test/chore` 前缀 + 中文描述；一个完整增量一个 commit。
- `references/` 下新增任何资料须在 `references/readme.md` 登记。

## 每次改动的验证清单（全过才算完成）

```bash
npm test            # vitest：编解码 + 回环集成 + 纯函数
npm run test:db     # 数据库自测：在 Electron 内置 Node（真实 ABI）上跑迁移/repo/FTS
npm run typecheck   # node16 / chrome108 两套类型基线
npm run build       # 三端产物
npm run smoke       # 构建 + 启动 1.5s 干净退出（退出码 0）
```

- 网络相关测试必须绑定 `127.0.0.1` 且 `broadcastTargets: []`——**测试永不向真实局域网发包**。
- 网络层（`src/main/net/`）的行为改动必须有对应回环集成测试。

## 环境与已知坑

- 开发机 Node ≥ 18（仅工具链；应用运行时是 Electron 内置 Node 16.17，与开发机无关）。
- macOS 上 `npm install` 后报 `Electron failed to install correctly`：解法见 README「常见问题」（ditto 手动解压 + printf 写 path.txt，不能带换行）。
- 本机双实例联调（验证发现/消息链路）：

```bash
PANTRY_USER_DATA=/tmp/pantry-dev2 PANTRY_UDP_PORT=27878 PANTRY_PEERS=127.0.0.1:17878 npm run dev
```

- Win7 终端为统一 64 位 VM：Win7 下默认禁硬件加速（已在 main 实现），不要移除。

## 决策分工

- 协议/底层技术细节：可自主决策，但必须落档（requirements §9 决议表 + 对应文档变更记录）。
- 产品可感知的取舍（功能有无、界面形态、默认值如图片 20MB 上限）：**由用户拍板**，不要代替用户决定。
- 里程碑与模块对照见 `docs/tech-design.md` §12；当前进度以 `git log` 为准（本文件不维护进度，防腐烂）。
