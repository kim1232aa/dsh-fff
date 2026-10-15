# Pi `@ff-labs/pi-fff` ↔ dsh-fff 对照（含网络调查）

> 本机源：`~/.pi/agent/npm/node_modules/@ff-labs/pi-fff` **v0.11.0**  
> 线上文档：[npm @ff-labs/pi-fff](https://www.npmjs.com/package/@ff-labs/pi-fff) · [pi.dev 包页](https://pi.dev/packages/@ff-labs/pi-fff) · [GitHub README](https://github.com/dmtrKovalenko/fff/blob/main/packages/pi-fff/README.md)  
> SDK：[npm @ff-labs/fff-node](https://www.npmjs.com/package/@ff-labs/fff-node) · [finder.d.ts](https://cdn.jsdelivr.net/npm/@ff-labs/fff-node@0.11.0/dist/finder.d.ts)  
> MCP：`crates/fff-mcp`（[fff README 对 definitions_only](https://github.com/dmtrKovalenko/fff/blob/main/README.md) · [issue #619 output_mode/context](https://github.com/dmtrKovalenko/fff/issues/619)）  
> dsh：[Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool) · [Human Commands](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/commands) · [commands README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.md)

---

## 已对齐（工具 / 运行时）

| 能力 | 证据 | dsh-fff |
|---|---|---|
| `fffind` / `ffgrep` / `fff-multi-grep` | Pi README Tools | ✅ 同名（override→`glob`/`grep`/`multi_grep`） |
| path / exclude / limit / cursor / 弱匹配 / fuzzy fallback | Pi `src/index.ts` | ✅ |
| caseSensitive + README 别名 ignoreCase/literal | 源码 vs README 不一致；两侧都接 | ✅ |
| MCP `output_mode` | fff-mcp `OutputMode` + issue #619 | ✅ `outputMode`: content / files_with_matches / count / usage |
| MCP `definitions_only` | fff README | ✅ `definitionsOnly` |
| query / maxResults 别名 | MCP GrepParams | ✅ |
| 长驻 FileFinder、watch、frecency、git、scan | fff-node API | ✅ |
| DB：nvim → `~/.pi/agent/fff` → `~/.dsh/fff` | Pi paths.ts + 本机已有 `~/.pi/agent/fff` | ✅ |
| Env `FFF_*` / `PI_FFF_MODE` | Pi Flags | ✅ + `DSH_FFF_MODE` |
| `/fff-health` `/fff-rescan` `/fff-mode` | Pi Commands | ✅ **兼有**：模型工具 `fff_*` + 可选 `ctx.commands` slash（有 commands 服务时） |
| `trackQuery` | [finder.d.ts trackQuery](https://cdn.jsdelivr.net/npm/@ff-labs/fff-node@0.11.0/dist/finder.d.ts) | ✅ 工具 `fff_track`（Pi 由 UI 隐式写） |
| multi-grep 默认开 | Pi 需 `PI_FFF_MULTIGREP=1` | ✅ 超集 |

---

## 本轮已补

- MCP `outputMode` 四态格式化（`lib/output-mode.js`）
- `ignoreCase` / `literal` / `query` / `maxResults` 别名
- `fff_track` + 绝对路径 canonicalize
- 可选 slash：`/fff-health` `/fff-rescan` `/fff-mode`（`lib/commands.js`，`ctx.inject(['commands'])`）
- `tools-and-ui` 配置接受（行为 ≡ tools-only）
- `warnOnHomeDirScan` + 共用 Pi frecency 目录
- PARITY / README.zh-CN 按 Pi README 结构重写

---

## 不可实现专节（必须告知用户）

下列能力**无法在 dsh 完整复刻**；不是忘了做，是宿主没有对等面。调查结论如下。

### 1. FFF 驱动的 `@` 文件补全（tools-and-ui / override 的 UI 半边）

| | |
|---|---|
| **Pi 做什么** | `ctx.ui.addAutocompleteProvider`，用 `mixedSearch` 给编辑器 `@path` 补全（[Pi README Modes](https://www.npmjs.com/package/@ff-labs/pi-fff)） |
| **dsh 有没有** | 公开文档只有 **模型工具** `defineTool`（[Build a tool](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)）与 **人类 slash 命令** `ctx.commands.register`（[commands README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.md)）。**没有**「输入框 `@` 文件提及 → 插件可替换补全源」的稳定公共 API。本机检索 `dsh-tui` / harness 文档未见 `addAutocompleteProvider` 对等物。 |
| **后果** | `mode: tools-and-ui` 在 dsh **只能等于 tools-only**；不会出现 Pi 那种 `@` 用 FFF 排序。 |
| **替代** | 模型侧继续用 `fffind`；人类侧无 `@` 补全增强。 |

### 2. Pi TUI 结果渲染 / footer「正在索引 $HOME」状态条

| | |
|---|---|
| **Pi** | `renderCall` / `renderResult` / `ui.setStatus`（扩展源码） |
| **dsh** | 工具用 `output.render` 出文本；无 Pi 式 footer 组件 API |
| **替代** | `warnOnHomeDirScan` → `ctx.logger.warn`；结果为纯文本 |

### 3. 会话内热切换 override + `/reload` 改工具名

| | |
|---|---|
| **Pi** | `/fff-mode override` 写入 session，再 `/reload` 重注册 `find`/`grep` 名 |
| **dsh** | Cordis 插件树在 profile boot 时固定；改名需改 Config + `patches/override.yml` **并重启 profile**。有 `/fff-mode` 命令可**记录意图并提示**，但**不能**在同一次进程里安全卸掉 `tool-fs-search` 再抢注 `glob`/`grep`。 |
| **证据** | [dsh-commands](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.md)：命令不进入模型消息；工具注册在 plugin `apply`。 |

### 4. Headless / ACP 无 slash 命令面

| | |
|---|---|
| **dsh** | 「UI-less demos and ACP automation do not provide this command surface」（[commands README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.md)） |
| **后果** | `ffftest`（headless）只有工具 `fff_health` / `fff_rescan`，没有 `/fff-*` |
| **替代** | 模型或脚本调同名工具 |

### 5. Pi session custom entry 恢复 `/fff-mode`

| | |
|---|---|
| **Pi** | `pi.appendEntry('fff-mode', { mode })`，resume 时恢复 |
| **dsh** | 无 Pi coding-agent 的 custom entry 协议 |
| **替代** | profile Config / env 持久化 |

### 6. MCP subprocess 回退

| | |
|---|---|
| **状态** | 本机 `@ff-labs/fff-node` + `fff-bin-linux-x64-*` 已可用，**不需要**再拉 MCP 二进制 |
| **若将来 Node SDK 不可用** | 可再评估 `fff-mcp`；当前刻意不做双栈 |

---

## 模式映射

| Pi mode | dsh |
|---|---|
| `tools-and-ui` | 接受配置；**无 `@` UI** → 行为 = `tools-only`（上表 §1） |
| `tools-only` | 默认旁挂 |
| `override` | 工具改名 + **必须** `patches/override.yml` 关掉 `tool-fs-search` |

---

## 验收

- [x] 对照写明不可实现 + 链接  
- [x] output_mode / track / commands / 别名已实现  
- [x] `npm test` + 真实搜仓库
- [x] Pi vs dsh 实测对比（见 [docs/compare/REPORT.md](./docs/compare/REPORT.md)）

---

## 实测对比（2026-10-15 CST）

同一仓库快照上跑 Pi `@ff-labs/pi-fff@0.11.0` 与 dsh-fff 工具 `execute`，报告与截图：

→ **[docs/compare/REPORT.md](./docs/compare/REPORT.md)** · [verdicts.json](./docs/compare/verdicts.json) · [shots/](./docs/compare/shots/)

| 结论 | 细节 |
|---|---|
| 用例 1–5、7 | 输出**逐字节相同** |
| 用例 6 multi-grep | Pi 默认不注册（需 `PI_FFF_MULTIGREP=1`）；打开后相同。dsh 默认 `tools.multiGrep=true`（超集，未改代码） |
| 用例 8 health/rescan | 核心字段一致，格式不同（Pi slash/`[info]` vs dsh 工具） |
| 用例 9 outputMode | 仅 dsh 有（MCP 扩展） |
| E2E | Pi（xai/grok）与 dsh（`antigravity/gemini-3.8-flash`）均调用 `ffgrep`，命中一致：`ssrf-protection.ts` 389/405/433 |

截图为真实工具输出渲染（box 无 xterm），左 Pi / 右 dsh。
