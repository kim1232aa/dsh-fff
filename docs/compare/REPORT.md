# Pi-fff vs dsh-fff 实测对比

- 目标仓库：`/workspace/pi-web-access` 的快照 `tmp/repo-snapshot`（两边同一份）
- Pi 侧：真实加载 `~/.pi/agent/npm/node_modules/@ff-labs/pi-fff/src/index.ts`（用 pi 自带 jiti），走 `session_start` → 调工具 `execute`；health/rescan 走 `/fff-health` `/fff-rescan` 命令 handler（Pi 里它们是命令不是工具）。`pi-harness.mjs`
- dsh 侧：真实加载 `/workspace/dsh-fff/index.js` 的 `apply()`，取注册的工具调 `execute`。`dsh-harness.mjs`
- 两边都用全新的 frecency/history DB，避免排序被历史偏置。原始输出：`pi/caseN.txt`、`dsh/caseN.txt`；截图画廊：[`shots.html`](./shots.html)（内嵌压缩 JPEG；原始 PNG 在本地 `shots/`，MCP 无法推二进制）
- 端到端（模型驱动 CLI）：`e2e/pi.txt`、`e2e/dsh2.txt`

| # | 用例 | 参数 | 结论 |
|---|---|---|---|
| 1 | fffind 模糊文件名 | `{"pattern": "ssrf protect"}` | 一致（逐字节相同） |
| 2 | fffind 拼写错误/模糊 | `{"pattern": "yutube extrct"}` | 一致（逐字节相同） |
| 3 | ffgrep 纯文本 | `{"pattern": "isBlockedIPv4", "limit": 10}` | 一致（逐字节相同） |
| 4 | ffgrep 正则 | `{"pattern": "export (async )?function fetch\\w+", "limit": 10}` | 一致（逐字节相同） |
| 5 | ffgrep 路径约束+排除+上下文 | `{"pattern": "AbortSignal", "path": "*.ts", "exclude": "test/", "context": 1, "limit": 5}` | 一致（逐字节相同） |
| 6 | fff-multi-grep 多模式 | `{"patterns": ["TAVILY_API_KEY", "EXA_API_KEY", "BRAVE_API_KEY"], "constraints": "*.ts !test/", "limit": 10}` | 有差异：Pi 默认不注册 multi-grep（需 PI_FFF_MULTIGREP=1）；打开后输出逐字节相同。dsh 默认开启 |
| 7 | ffgrep 拼写错误→模糊回退 | `{"pattern": "retriveContent", "limit": 5}` | 一致（逐字节相同，含模糊回退提示与 cursor） |
| 8 | health + rescan | `{}` | 有差异：内容一致，格式不同（Pi notify 带 [info] 前缀 + Mode 行；dsh 多 basePath/DBs/Aux 行） |
| 9 | ffgrep outputMode=files_with_matches | `{"pattern": "isBlockedIPv4", "outputMode": "files_with_matches", "limit": 10}` | 有差异：outputMode 是 dsh 扩展参数，Pi schema 无此参数→忽略按 content 输出 |
| E2E | `pi -p` vs `dsh --profile ffftest`（现 `antigravity/gemini-3.8-flash`） | ffgrep isBlockedIPv4 | 一致：Gemini 调用 ffgrep，命中与 Pi 相同（见 `e2e/dsh-gemini.txt`、[`shots.html`](./shots.html#e2e-gemini)） |

## 差异说明

1. **multi-grep 默认开关**：pi-fff 0.11.0 源码 `enableMultiGrep = process.env.PI_FFF_MULTIGREP === '1'`（注释称该工具“有害”，默认关闭）。默认 Pi 只注册 `ffgrep`、`fffind`。dsh-fff 默认 `tools.multiGrep=true`。若要完全一致，dsh 应改为默认关闭/读同一 env。
2. **health/rescan 形态**：Pi 是斜杠命令（经 `ctx.ui.notify` 输出，带 `[info]`），并显示 `Mode:`；dsh 是工具 `fff_health`/`fff_rescan`，多输出 basePath、DB 路径、aux picker 数，未显示 Mode。核心字段（版本、索引文件数、git、frecency/history 状态）一致。
3. **outputMode**：Pi schema 没有此参数（被忽略，按 content 输出）；dsh 的 `files_with_matches` 生效并附 “only match — 直接读” 提示，属 dsh 额外扩展，不是 Pi 行为。
4. **结果顺序/数量/格式**：用例 1–7（打开 multigrep 后）逐字节一致，含排序、截断、`[def]` 外的格式、分页 cursor、模糊回退提示。
5. **端到端**：Pi 用 xai/grok 调用 ffgrep 成功。ffftest 原 `deepseek-official/deepseek-flash` 余额不足；已改为 `antigravity/gemini-3.8-flash` 复测成功，命中与 Pi 一致（`e2e/dsh-gemini.txt`）。

## 过程中发现并修复

- ffftest profile 里装的是旧拷贝（缺 `lib/commands.js`、`lib/output-mode.js`），启动报 `dsh-fff (dsh-fff): failed to import`。已 `dsh plugin --profile ffftest remove dsh-fff` + `add file:/workspace/dsh-fff --force` 重装，警告消失。

## 未做到

- 真实终端（xterm）截图：box 无 xterm，截图为输出渲染的 HTML（Chrome headless），内容是真实运行输出，未伪造。
- （已解决）dsh 端到端：改用 gemini-3.8-flash 后通过。
