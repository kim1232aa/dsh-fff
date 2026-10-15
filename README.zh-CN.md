# dsh-fff

把 [FFF](https://github.com/dmtrKovalenko/fff) 接到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：用 Rust 原生、SIMD 加速的文件查找器，替换/旁挂 dsh 自带的 `glob`/`grep`（ripgrep 子进程）。

对标本机 Pi 扩展 [`@ff-labs/pi-fff`](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff) v0.11.0 + MCP `fff-mcp`。逐项对照见 [PARITY.md](./PARITY.md)。

## 做什么

| dsh 内置 | dsh-fff | 提升 |
|---|---|---|
| `glob`（ripgrep `--files`） | `fffind`（FFF `fileSearch`） | 模糊匹配、frecency、git 感知、预索引 |
| `grep`（ripgrep 子进程） | `ffgrep`（FFF `grep`） | 进程内 SIMD、按 frecency 排文件、mmap 缓存 |
| （无） | `fff-multi-grep`（`multiGrep`） | 多模式 OR（Aho-Corasick） |
| （无 `@` 补全） | — | dsh 无编辑器 `@` 面，不移植 |

### 相对内置工具的优势

- **无子进程** — Node binding 调 Rust，不 fork `rg`/`fd`
- **预索引** — 后台扫盘，搜索接近即时
- **Frecency** — 常访问文件更靠前；可与 Neovim / Pi 共用 DB
- **查询历史** — `fff_track` 写入选中关系，combo boost
- **Git 感知** — 脏文件标注/加权
- **Smart-case** — 全小写则不区分大小写
- **模糊找文件** — 容错拼写
- **Cursor 分页** — grep/find 均可续页
- **outputMode** — 对齐 MCP：`content` / `files_with_matches` / `count` / `usage`

## 安装

**禁止**装进占用 **3080** 的 `web` profile。用独立 profile：

```bash
dsh plugin --profile ffftest --from-default-profile headless add file:/workspace/dsh-fff
# 或
dsh plugin --profile ffftest add npm:dsh-fff   # 发布后
```

默认 **旁挂**：保留内置 `glob`/`grep`，额外注册 `fffind` / `ffgrep` / `fff-multi-grep`。

**顶替内置**（override）：叠加补丁关掉 `tool-fs-search`：

```bash
dsh --profile ffftest --patch /path/to/dsh-fff/patches/override.yml …
```

或把 `patches/override.yml` 合并进该 profile 的 `cordis.patch.yml`。

## 工具

### `ffgrep`

内容搜索。Smart-case；自动识别 regex vs 字面量；可 fuzzy 回退。

| 参数 | 说明 |
|---|---|
| `pattern` / `query` | 搜索文本或正则 |
| `path` | 目录/文件/glob 约束 |
| `exclude` | 排除（`test/,*.min.js`） |
| `caseSensitive` / `ignoreCase` | 强制大小写；默认 smart-case |
| `literal` | `true` 强制字面量；默认自动 |
| `context` | 上下文明细行数 |
| `limit` / `maxResults` | 最大命中（默认 20，与 Pi 源码一致） |
| `cursor` | 上一页返回的分页游标 |
| `outputMode` | `content`（默认）/ `files_with_matches` / `count` / `usage` |
| `definitionsOnly` | 优先定义行；若无则回退并提示 |

### `fffind`

模糊路径 / glob。Frecency 排序。

| 参数 | 说明 |
|---|---|
| `pattern` | 模糊查询（多词 = AND） |
| `path` / `exclude` | 约束 |
| `limit` | 每页条数（默认 30） |
| `cursor` | 分页 |

### `fff-multi-grep`

多模式 OR（字面量）。

| 参数 | 说明 |
|---|---|
| `patterns` | 字符串数组（建议含 snake/camel/Pascal 变体） |
| `constraints` | 如 `*.{ts,tsx} !test/` |
| `context` / `limit` / `cursor` / `outputMode` / `definitionsOnly` | 同 grep |

### 运维工具

| 工具 | 对应 Pi | 说明 |
|---|---|---|
| `fff_health` | `/fff-health` | 版本、索引数、git、DB、扫描进度 |
| `fff_rescan` | `/fff-rescan` | 触发重扫 |
| `fff_track` | （Pi UI 隐式） | `trackQuery(query, file)` 写历史 |

## 模式

| mode | 行为 |
|---|---|
| `tools-only`（默认） | 旁挂 `fffind`/`ffgrep`/`fff-multi-grep` |
| `tools-and-ui` | dsh **无 `@` UI**，行为与 `tools-only` 相同（为兼容 Pi 配置而接受） |
| `override` | 工具名改为 `glob`/`grep`/`multi_grep`；须同时 disable `tool-fs-search` |

优先级：环境变量 `DSH_FFF_MODE` / `PI_FFF_MODE` → Config `mode` → 默认 `tools-only`。

## 配置（Config）

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `tools-only` | 见上 |
| `basePath` | 首次调用 cwd | 索引根 |
| `frecencyDbPath` / `historyDbPath` | 见 [数据](#数据) | LMDB |
| `enableFsRootScanning` | `false` | 允许索引 `/` |
| `enableHomeDirScanning` | `true` | 允许索引 `$HOME` |
| `warnOnHomeDirScan` | `true` | 索引 `$HOME` 时打 logger 警告 |
| `followSymlinks` | `true` | 跟随目录符号链接 |
| `fuzzyFallback` | `true` | 精确 grep 无结果时模糊回退 |
| `tools.*` | 全开 | 按工具开关 |

环境变量（与 Pi 对齐）：`FFF_FRECENCY_DB`、`FFF_HISTORY_DB`、`FFF_ENABLE_ROOT_SCAN`、`FFF_ENABLE_HOME_SCAN`、`FFF_WARN_HOME_SCAN`、`FFF_FOLLOW_SYMLINKS`、`PI_FFF_MODE` / `DSH_FFF_MODE`。

## 数据

两个 LMDB：

1. **frecency** — 访问频率/近因  
2. **history** — 查询→选中文件  

解析顺序（各路径独立）：

1. Config  
2. Env（`FFF_FRECENCY_DB` / `FFF_HISTORY_DB`）  
3. 已有 fff.nvim DB  
4. 已有 `~/.pi/agent/fff/{frecency,history}`（与本机 Pi 共用）  
5. `~/.dsh/fff/{frecency,history}`

DB 打不开时降级为无持久化，不中断。

## 安全

- 无 shell、无网络、无遥测  
- 仅本地索引与搜索  

## 开发

```bash
cd /workspace/dsh-fff && npm test
```

硬约束：**勿占用/改动端口 3080**。
