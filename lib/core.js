/**
 * Tool execution core: fffind / ffgrep / fff-multi-grep / health / rescan.
 */
import { createCursorStore } from './cursors.js'
import {
  formatGrepOutput,
  formatFindOutput,
  clampContext,
  applyDefinitionsOnly,
  GREP_CONTEXT_MAX,
} from './format.js'
import {
  formatByOutputMode,
  parseOutputMode,
  grepOptionsForMode,
} from './output-mode.js'
import { FinderRuntime } from './finder.js'

export const DEFAULT_GREP_LIMIT = 20
export const DEFAULT_FIND_LIMIT = 30
export const GREP_PAGE_SIZE_MAX = 50
export const GREP_MAX_MATCHES_PER_FILE = 200
export const GREP_TIME_BUDGET_MS = 10_000

function isWildcardOnly(pattern) {
  const hasRegexSyntax = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!hasRegexSyntax) return false
  const p = pattern.trim()
  return /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(p)
}

function detectGrepMode(pattern) {
  const hasRegexSyntax = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!hasRegexSyntax) return 'plain'
  try {
    new RegExp(pattern)
    return 'regex'
  } catch {
    return 'plain'
  }
}

export function createCore(config = {}) {
  const runtime = new FinderRuntime(config)
  const cursors = createCursorStore()
  let ready = null

  async function ensureReady() {
    if (!ready) ready = runtime.ensureMain(runtime.basePath)
    return ready
  }

  return {
    runtime,
    cursors,
    destroy() {
      cursors.clear()
      runtime.destroy()
      ready = null
    },

    async fffind(args, signal) {
      if (signal?.aborted) throw new Error('Operation aborted')
      await ensureReady()

      const resumed = args.cursor ? cursors.getFind(args.cursor) : undefined
      if (args.cursor && !resumed) throw new Error(`Unknown find cursor: ${args.cursor}`)

      let finder, query, root
      if (resumed) {
        if (resumed.auxRoot) {
          const aux = await runtime.acquireAux(resumed.auxRoot, { exact: true })
          finder = aux.finder
          root = aux.root
        } else {
          finder = await runtime.ensureMain(runtime.basePath)
          root = runtime.basePath
        }
        query = resumed.query
      } else {
        const resolved = await runtime.resolveForPath(args.path, args.pattern, args.exclude)
        finder = resolved.finder
        query = resolved.query
        root = resolved.root
      }

      const pattern = resumed ? resumed.pattern : args.pattern
      const pageSize = resumed
        ? resumed.pageSize
        : Math.max(1, Math.min(500, args.limit ?? DEFAULT_FIND_LIMIT))
      const pageIndex = resumed?.nextPageIndex ?? 0

      const searchResult = finder.fileSearch(query, { pageIndex, pageSize })
      if (!searchResult.ok) throw new Error(searchResult.error)

      const result = searchResult.value
      const formatted = formatFindOutput(result, pageSize, pattern)
      let output = formatted.output

      const shownSoFar = pageIndex * pageSize + result.items.length
      const hasMore =
        result.items.length >= pageSize && result.totalMatched > shownSoFar

      const notices = []
      if (formatted.weak && formatted.shownCount > 0) {
        notices.push(
          `Query "${pattern}" produced only weak scattered fuzzy matches. Output capped at ${formatted.shownCount}/${result.totalMatched}.`,
        )
      }
      if (!formatted.weak && hasMore) {
        const remaining = result.totalMatched - shownSoFar
        const cursorId = cursors.storeFind({
          query,
          pattern,
          pageSize,
          nextPageIndex: pageIndex + 1,
          auxRoot: root !== runtime.basePath ? root : undefined,
        })
        notices.push(
          `${remaining} more match${remaining === 1 ? '' : 'es'} available. cursor="${cursorId}" to continue`,
        )
      }
      if (notices.length) output += `\n\n[${notices.join('. ')}]`

      return {
        text: output,
        totalMatched: result.totalMatched,
        totalFiles: result.totalFiles,
        pageIndex,
        hasMore,
        weak: formatted.weak,
      }
    },

    async ffgrep(args, signal) {
      if (signal?.aborted) throw new Error('Operation aborted')
      await ensureReady()

      const pattern = args.pattern ?? args.query
      if (!pattern) throw new Error('pattern is required')

      if (isWildcardOnly(pattern)) {
        return {
          text: `Pattern '${pattern}' matches everything — grep needs a concrete substring or identifier. Example: pattern: 'MyClass' or pattern: 'export function'.`,
          totalMatched: 0,
          totalFiles: 0,
        }
      }

      const resolved = await runtime.resolveForPath(args.path, pattern, args.exclude)
      const finder = resolved.finder
      const query = resolved.query

      const effectiveLimit = Math.max(1, args.limit ?? args.maxResults ?? DEFAULT_GREP_LIMIT)
      const pageSize = Math.min(effectiveLimit, GREP_PAGE_SIZE_MAX)
      const outModeEarly = parseOutputMode(args.outputMode ?? args.output_mode)
      const modeTweaks = grepOptionsForMode(outModeEarly, args.context)
      const context = clampContext(args.context !== undefined ? args.context : modeTweaks.beforeContext)
      const mode = detectGrepMode(pattern)
      // caseSensitive:true → sensitive; ignoreCase:true → always insensitive; else smart-case
      let smartCase = true
      if (args.caseSensitive === true) smartCase = false
      if (args.ignoreCase === true) smartCase = true
      if (args.ignoreCase === false) smartCase = false

      // literal:true forces plain; literal:false keeps detected mode; omit = auto (Pi behavior)
      let grepMode = mode
      if (args.literal === true) grepMode = 'plain'
      else if (args.literal === false && mode === 'plain') {
        // caller asked for non-literal but pattern has no regex syntax — stay plain
        grepMode = mode
      }

      const grepOpts = {
        mode: grepMode,
        smartCase,
        maxMatchesPerFile: modeTweaks.maxMatchesPerFile || GREP_MAX_MATCHES_PER_FILE,
        pageSize,
        cursor: (args.cursor ? cursors.getGrep(args.cursor) : null) ?? null,
        beforeContext: context,
        afterContext: clampContext(modeTweaks.afterContext ?? context),
        classifyDefinitions: true,
        timeBudgetMs: GREP_TIME_BUDGET_MS,
      }
      let grepResult = finder.grep(query, grepOpts)
      if (!grepResult.ok) throw new Error(grepResult.error)

      let result = grepResult.value
      let fuzzyNotice = null

      // Auto fuzzy fallback (plain mode, no matches, first page)
      if (
        result.items.length === 0 &&
        !result.nextCursor &&
        !args.cursor &&
        mode !== 'regex' &&
        config.fuzzyFallback !== false
      ) {
        const lastSeg = args.path?.split(/[\\/]/).pop() ?? ''
        const pathTargetsFile = /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSeg)
        const fuzzyQuery = pathTargetsFile ? pattern : query
        const fuzzy = finder.grep(fuzzyQuery, {
          mode: 'fuzzy',
          smartCase: grepOpts.smartCase,
          maxMatchesPerFile: GREP_MAX_MATCHES_PER_FILE,
          pageSize,
          cursor: null,
          beforeContext: 0,
          afterContext: 0,
          classifyDefinitions: true,
          timeBudgetMs: GREP_TIME_BUDGET_MS,
        })
        if (fuzzy.ok && fuzzy.value.items.length > 0) {
          fuzzyNotice = '0 exact matches. Maybe you meant this?'
          result = fuzzy.value
        }
      }

      const def = applyDefinitionsOnly(result, args.definitionsOnly === true)
      result = def.result
      const outMode = parseOutputMode(args.outputMode ?? args.output_mode)

      let output = formatByOutputMode(outMode, result, formatGrepOutput)
      const notices = []
      if (def.notice) notices.push(def.notice)
      if (result.regexFallbackError) {
        notices.push(`Invalid regex: ${result.regexFallbackError}, used literal match`)
      }
      if (result.nextCursor) {
        notices.push(`Continue with cursor="${cursors.storeGrep(result.nextCursor)}"`)
      }
      if (notices.length) output += `\n\n[${notices.join('. ')}]`
      if (fuzzyNotice) output = `[${fuzzyNotice}]\n${output}`

      return {
        text: output,
        outputMode: outMode,
        totalMatched: result.totalMatched,
        totalFiles: result.totalFiles,
        totalFilesSearched: result.totalFilesSearched,
      }
    },

    async multiGrep(args, signal) {
      if (signal?.aborted) throw new Error('Operation aborted')
      await ensureReady()

      let patterns = args.patterns
      if (typeof patterns === 'string') {
        try {
          patterns = patterns.startsWith('[') ? JSON.parse(patterns) : [patterns]
        } catch {
          patterns = [patterns]
        }
      }
      if (!Array.isArray(patterns) || patterns.length === 0) {
        throw new Error('patterns array must have at least 1 element')
      }

      const finder = await runtime.ensureMain(runtime.basePath)
      const effectiveLimit = Math.max(1, args.limit ?? args.maxResults ?? DEFAULT_GREP_LIMIT)
      const pageSize = Math.min(effectiveLimit, GREP_PAGE_SIZE_MAX)
      const outModeEarly = parseOutputMode(args.outputMode ?? args.output_mode)
      const modeTweaks = grepOptionsForMode(outModeEarly, args.context)
      const context = clampContext(args.context !== undefined ? args.context : modeTweaks.beforeContext)

      const grepResult = finder.multiGrep({
        patterns,
        constraints: args.constraints,
        maxMatchesPerFile: modeTweaks.maxMatchesPerFile || GREP_MAX_MATCHES_PER_FILE,
        pageSize,
        smartCase: args.caseSensitive !== true,
        cursor: (args.cursor ? cursors.getGrep(args.cursor) : null) ?? null,
        beforeContext: context,
        afterContext: clampContext(modeTweaks.afterContext ?? context),
        classifyDefinitions: true,
      })
      if (!grepResult.ok) throw new Error(grepResult.error)

      let result = grepResult.value
      const def = applyDefinitionsOnly(result, args.definitionsOnly === true)
      result = def.result
      const outMode = parseOutputMode(args.outputMode ?? args.output_mode)

      let output = formatByOutputMode(outMode, result, formatGrepOutput)
      const notices = []
      if (def.notice) notices.push(def.notice)
      if (result.items.length >= effectiveLimit) {
        notices.push(`${effectiveLimit}+ matches (refine patterns)`)
      }
      if (result.nextCursor) {
        notices.push(
          `More available. cursor="${cursors.storeGrep(result.nextCursor)}" to continue`,
        )
      }
      if (notices.length) output += `\n\n[${notices.join('. ')}]`

      return {
        text: output,
        outputMode: outMode,
        totalMatched: result.totalMatched,
        totalFiles: result.totalFiles,
        patterns,
      }
    },

    async track(args, signal) {
      if (signal?.aborted) throw new Error('Operation aborted')
      await ensureReady()
      const query = args.query ?? args.pattern
      let file = args.file ?? args.selectedFile ?? args.path
      if (!query || !file) throw new Error('track requires query and file')
      const finder = await runtime.ensureMain(runtime.basePath)
      const { default: nodePath } = await import('node:path')
      const abs = nodePath.isAbsolute(String(file))
        ? String(file)
        : nodePath.join(runtime.basePath, String(file))
      const r = finder.trackQuery(String(query), abs)
      if (!r.ok) throw new Error(r.error)
      return { text: `Tracked query "${query}" → ${abs}`, ok: true, query, file: abs }
    },

    async health() {
      try {
        await ensureReady()
      } catch (e) {
        return { text: `FFF not ready: ${e.message}`, ok: false }
      }
      const h = runtime.health()
      const lines = [
        `FFF v${h.version ?? '?'}`,
        `basePath: ${h.basePath}`,
        `Git: ${h.git?.repositoryFound ? `yes (${h.git.workdir ?? 'unknown'})` : 'no'}`,
        `Picker: ${h.filePicker?.initialized ? `${h.filePicker.indexedFiles ?? 0} files` : 'not initialized'}`,
        `Frecency: ${h.frecency?.initialized ? 'active' : 'disabled'}${h.dbDisabled ? ' (db fallback)' : ''}`,
        `Query tracker: ${h.queryTracker?.initialized ? 'active' : 'disabled'}`,
        `DBs: frecency=${h.dbs?.frecency} history=${h.dbs?.history}`,
        `Aux pickers: ${h.auxCount ?? 0}`,
      ]
      if (h.progress) {
        lines.push(
          `Scanning: ${h.progress.isScanning ? 'yes' : 'no'} (${h.progress.scannedFilesCount} files)`,
        )
      }
      if (h.lastDbError) lines.push(`Last DB error: ${h.lastDbError}`)
      return { text: lines.join('\n'), ok: h.ok !== false, ...h }
    },

    async rescan() {
      await ensureReady()
      const r = runtime.rescan()
      return {
        text: r.ok ? 'FFF rescan triggered' : `Rescan failed: ${r.error}`,
        ok: r.ok,
        error: r.error,
      }
    },
  }
}

export { GREP_CONTEXT_MAX }
