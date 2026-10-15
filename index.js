/**
 * dsh-fff — DeepSeek Harness plugin porting @ff-labs/pi-fff / fff-mcp:
 * fffind, ffgrep, fff-multi-grep (+ fff_health, fff_rescan).
 *
 * Runtime: in-process @ff-labs/fff-node (watch, content index, frecency, git).
 */
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createCore } from './lib/core.js'
import { toolSpecs } from './lib/tools.js'
import { registerFffCommands } from './lib/commands.js'

export const name = 'dsh-fff'
export const inject = ['tools']

export const Config = Schema.object({
  mode: Schema.union(['tools-only', 'tools-and-ui', 'override']).default('tools-only')
    .description('tools-only / tools-and-ui: register fffind/ffgrep/fff-multi-grep beside builtins (dsh has no @-autocomplete UI, so tools-and-ui ≡ tools-only). override: register as glob/grep/multi_grep (also disable tool-fs-search via patches/override.yml). Env: DSH_FFF_MODE / PI_FFF_MODE.'),
  basePath: Schema.string()
    .description('Index root (default: process cwd at first tool call).'),
  frecencyDbPath: Schema.string()
    .description('Frecency LMDB path (default: ~/.dsh/fff/frecency or existing fff.nvim db).'),
  historyDbPath: Schema.string()
    .description('Query-history LMDB path (default: ~/.dsh/fff/history or fff.nvim).'),
  enableFsRootScanning: Schema.boolean().default(false)
    .description('Allow indexing when basePath is filesystem root.'),
  enableHomeDirScanning: Schema.boolean().default(true)
    .description('Allow indexing when basePath is $HOME.'),
  followSymlinks: Schema.boolean().default(true)
    .description('Follow directory symlinks while indexing. Env: FFF_FOLLOW_SYMLINKS.'),
  warnOnHomeDirScan: Schema.boolean().default(true)
    .description('Log a warning when indexing $HOME (dsh has no TUI footer; uses ctx.logger). Env: FFF_WARN_HOME_SCAN.'),
  disableWatch: Schema.boolean().default(false)
    .description('Disable filesystem watch (static snapshot).'),
  disableContentIndexing: Schema.boolean().default(false)
    .description('Disable content index (grep still works via live scan).'),
  fuzzyFallback: Schema.boolean().default(true)
    .description('When ffgrep finds 0 exact matches, retry in fuzzy mode.'),
  tools: Schema.object({
    find: Schema.boolean().default(true),
    grep: Schema.boolean().default(true),
    multiGrep: Schema.boolean().default(true),
    health: Schema.boolean().default(true),
    rescan: Schema.boolean().default(true),
    track: Schema.boolean().default(true),
  }).default({}),
}).i18n({
  'zh-CN': {
    $description: 'FFF 模糊找文件 / 内容搜索（移植自 pi-fff / fff-mcp）。',
    mode: 'tools-only=旁挂 fff*；override=顶替内置 glob/grep（需叠加 patches/override.yml）。',
    basePath: '索引根目录（默认首次调用时的 cwd）。',
    frecencyDbPath: 'frecency 数据库路径。',
    historyDbPath: '查询历史数据库路径。',
    enableFsRootScanning: '允许从文件系统根目录建索引。',
    enableHomeDirScanning: '允许从 $HOME 建索引。',
    followSymlinks: '索引时跟随目录符号链接。',
    fuzzyFallback: '精确 grep 无结果时自动模糊回退。',
  },
})

function resolveMode(cfg) {
  const raw = process.env.DSH_FFF_MODE || process.env.PI_FFF_MODE || cfg.mode || 'tools-only'
  if (raw === 'override') return 'override'
  // tools-and-ui has no dsh equivalent beyond tools-only
  return 'tools-only'
}

function envBool(name, fallback) {
  const v = process.env[name]
  if (v === undefined) return fallback
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return fallback
}

export function apply(ctx, config) {
  const cfg = { ...(config ?? {}) }
  cfg.mode = resolveMode(cfg)
  cfg.enableFsRootScanning = envBool('FFF_ENABLE_ROOT_SCAN', cfg.enableFsRootScanning === true)
  cfg.enableHomeDirScanning = envBool('FFF_ENABLE_HOME_SCAN', cfg.enableHomeDirScanning !== false)
  cfg.followSymlinks = envBool('FFF_FOLLOW_SYMLINKS', cfg.followSymlinks !== false)
  cfg.warnOnHomeDirScan = envBool('FFF_WARN_HOME_SCAN', cfg.warnOnHomeDirScan !== false)
  if (process.env.FFF_FRECENCY_DB) cfg.frecencyDbPath = cfg.frecencyDbPath || process.env.FFF_FRECENCY_DB
  if (process.env.FFF_HISTORY_DB) cfg.historyDbPath = cfg.historyDbPath || process.env.FFF_HISTORY_DB

  const core = createCore(cfg)

  ctx.on('dispose', () => {
    try { core.destroy() } catch { /* ignore */ }
  })

  const boot = async (base) => {
    try {
      await core.runtime.ensureMain(base)
      const { isHomeDir } = await import('./lib/paths.js')
      if (cfg.warnOnHomeDirScan && cfg.enableHomeDirScanning !== false && isHomeDir(base)) {
        ctx.logger?.warn?.(
          `[dsh-fff] cwd is $HOME; indexing the whole home tree can use high CPU. Disable with enableHomeDirScanning:false / FFF_ENABLE_HOME_SCAN=0.`,
        )
      }
    } catch (err) {
      ctx.logger?.warn?.(`[dsh-fff] init: ${err.message}`)
    }
  }

  if (cfg.basePath) boot(cfg.basePath)

  for (const spec of toolSpecs(core, cfg)) {
    ctx.tools.register(defineTool(spec))
  }

  let liveMode = cfg.mode
  registerFffCommands(ctx, {
    core,
    getMode: () => liveMode,
    setMode: (m) => { liveMode = m },
  })
}
