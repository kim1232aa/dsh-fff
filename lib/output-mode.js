/**
 * MCP-aligned grep output modes: content | files_with_matches | count | usage.
 * Ported from crates/fff-mcp/src/output.rs (simplified for Node GrepMatch shape).
 */

export const OUTPUT_MODES = ['content', 'files_with_matches', 'count', 'usage']

export function parseOutputMode(raw) {
  if (!raw || typeof raw !== 'string') return 'content'
  const s = raw.trim().toLowerCase()
  return OUTPUT_MODES.includes(s) ? s : 'content'
}

const LARGE_FILE_BYTES = 20_000
const MAX_PREVIEW = 120
const MAX_LINE_LEN = 180
const MAX_DEF_EXPAND_FIRST = 8
const MAX_DEF_EXPAND = 5

function sizeTag(bytes) {
  if (!bytes || bytes < LARGE_FILE_BYTES) return ''
  const kb = Math.round(bytes / 1024)
  return ` (${kb}KB - use offset to read relevant section)`
}

function truncateLine(line, max = MAX_LINE_LEN) {
  const trimmed = (line ?? '').trimEnd()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

function isImportLine(line) {
  const t = (line ?? '').trim()
  return /^(import\s|from\s+\S+\s+import|require\s*\(|#include\s|use\s+\w|using\s+)/.test(t)
}

/** First match per file, preserving order. */
function collectFilePreview(items) {
  const seen = new Set()
  const out = []
  for (const m of items) {
    if (seen.has(m.relativePath)) continue
    seen.add(m.relativePath)
    out.push(m)
  }
  return out
}

function readSuggestion(filePreview) {
  if (!filePreview.length) return null
  const first = filePreview[0]
  const firstDef = filePreview.find(m => m.isDefinition) ?? null
  const suggest = firstDef ?? first
  const n = filePreview.length
  if (n === 1) return `→ Read ${suggest.relativePath} (only match — no need to search further)`
  if (firstDef && n <= 5) return `→ Read ${suggest.relativePath} (definition found)`
  if (firstDef) return `→ Read ${suggest.relativePath} (definition)`
  if (n <= 3) return `→ Read ${suggest.relativePath} (best match)`
  return `→ Read ${suggest.relativePath}`
}

export function formatFilesWithMatches(result) {
  const items = result.items ?? []
  if (!items.length) return 'No matches found'
  const preview = collectFilePreview(items)
  const lines = []
  const suggest = readSuggestion(preview)
  if (suggest) lines.push(suggest)
  const small = preview.length <= 5
  for (let i = 0; i < preview.length; i++) {
    const m = preview[i]
    const defTag = m.isDefinition ? ' [def]' : ''
    lines.push(`${m.relativePath}${defTag}${sizeTag(m.size)}`)
    if (m.lineContent && (m.isDefinition || i === 0 || small)) {
      lines.push(`  ${m.lineNumber}: ${truncateLine(m.lineContent, MAX_PREVIEW)}`)
      if (m.isDefinition && m.contextAfter?.length) {
        const lim = i === 0 ? MAX_DEF_EXPAND_FIRST : MAX_DEF_EXPAND
        for (let j = 0; j < Math.min(lim, m.contextAfter.length); j++) {
          const ctx = m.contextAfter[j]
          if (!ctx.trim()) break
          lines.push(`  ${m.lineNumber + 1 + j}| ${truncateLine(ctx, MAX_PREVIEW)}`)
        }
      }
    }
  }
  return lines.join('\n')
}

export function formatCount(result) {
  const items = result.items ?? []
  if (!items.length) return 'No matches found'
  const counts = new Map()
  const order = []
  for (const m of items) {
    if (!counts.has(m.relativePath)) {
      counts.set(m.relativePath, 0)
      order.push(m.relativePath)
    }
    counts.set(m.relativePath, counts.get(m.relativePath) + 1)
  }
  const lines = order.map(p => `${p}: ${counts.get(p)}`)
  lines.push(`total: ${items.length} matches in ${order.length} files`)
  return lines.join('\n')
}

/**
 * usage mode: compact, defs-first, import demotion, char budget, read hint.
 */
export function formatUsage(result, { maxChars } = {}) {
  const items = result.items ?? []
  if (!items.length) return 'No matches found'

  const preview = collectFilePreview(items)
  const uniqueFiles = preview.length
  const budget =
    maxChars ??
    (uniqueFiles <= 3 ? 5000 : uniqueFiles <= 8 ? 3500 : 2500)

  const lines = []
  const suggest = readSuggestion(preview)
  if (suggest) {
    // shorter form for usage
    const firstDef = preview.find(m => m.isDefinition)
    const path = (firstDef ?? preview[0]).relativePath
    if (uniqueFiles === 1) lines.push(`→ Read ${path} (only match)`)
    else if (firstDef) lines.push(`→ Read ${path} [def]`)
    else if (uniqueFiles <= 3) lines.push(`→ Read ${path} (best match)`)
  }
  if ((result.totalMatched ?? items.length) > items.length) {
    lines.push(`${items.length}/${result.totalMatched} matches shown`)
  }

  const indices = items.map((_, i) => i)
  indices.sort((a, b) => {
    const rank = m => (m.isDefinition ? 0 : isImportLine(m.lineContent) ? 2 : 1)
    return rank(items[a]) - rank(items[b])
  })

  let charCount = lines.join('\n').length
  let shown = 0
  let currentFile = ''
  const defExpanded = new Set()

  for (const idx of indices) {
    const m = items[idx]
    const chunkLines = []
    if (m.relativePath !== currentFile) {
      currentFile = m.relativePath
      chunkLines.push(currentFile)
    }
    if (isImportLine(m.lineContent) && defExpanded.size > 0) continue

    chunkLines.push(` ${m.lineNumber}: ${truncateLine(m.lineContent)}`)

    if (m.isDefinition && m.contextAfter?.length && !defExpanded.has(m.relativePath)) {
      const lim = defExpanded.size === 0 ? MAX_DEF_EXPAND_FIRST : MAX_DEF_EXPAND
      defExpanded.add(m.relativePath)
      for (let j = 0; j < Math.min(lim, m.contextAfter.length); j++) {
        const ctx = m.contextAfter[j]
        if (!ctx.trim()) break
        chunkLines.push(`  ${m.lineNumber + 1 + j}| ${truncateLine(ctx)}`)
      }
    }

    const chunk = chunkLines.join('\n')
    if (charCount + chunk.length > budget && shown > 0) break
    charCount += chunk.length + 1
    lines.push(chunk)
    shown++
  }

  return lines.join('\n')
}

/** Dispatch by mode; `contentFormatter` is the existing formatGrepOutput. */
export function formatByOutputMode(mode, result, contentFormatter) {
  switch (parseOutputMode(mode)) {
    case 'files_with_matches':
      return formatFilesWithMatches(result)
    case 'count':
      return formatCount(result)
    case 'usage':
      return formatUsage(result)
    default:
      return contentFormatter(result)
  }
}

/** Grep engine tweaks per output_mode (MCP make_grep_options). */
export function grepOptionsForMode(mode, context) {
  const m = parseOutputMode(mode)
  const isUsage = m === 'usage'
  const maxMatchesPerFile =
    m === 'files_with_matches' ? 1 : isUsage ? 8 : 200
  const ctxLines = isUsage ? (context ?? 1) : (context ?? 0)
  // usage/content with no explicit context: MCP auto-expands defs via after_context
  const autoExpand = !isUsage && ctxLines === 0 && m === 'content'
  const afterContext = autoExpand ? Math.max(ctxLines, 0) : ctxLines
  // For content with explicit context, before=after=context.
  // For usage default context=1.
  // Keep classifyDefinitions always on at call site.
  return {
    mode: m,
    maxMatchesPerFile,
    beforeContext: ctxLines,
    afterContext: m === 'usage' ? ctxLines : afterContext,
    // content default: don't force auto-expand after unless caller wants;
    // we rely on classifyDefinitions + formatUsage for usage mode.
    isUsage,
    isFilesWithMatches: m === 'files_with_matches',
  }
}
