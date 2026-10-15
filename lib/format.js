/** Output formatting + weak-match / annotations (ported from pi-fff). */

export const GREP_MAX_LINE_LENGTH = 500
export const GREP_CONTEXT_MAX = 20
export const FIND_WEAK_SAMPLE_SIZE = 5
const HOT_FRECENCY = 25
const WARM_FRECENCY = 20

export function truncateLine(line, max = GREP_MAX_LINE_LENGTH) {
  const trimmed = line.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`
}

export function clampContext(context) {
  if (!context || context < 0) return 0
  return Math.min(Math.floor(context), GREP_CONTEXT_MAX)
}

export function fffFileAnnotation(item) {
  const git = item.gitStatus
  if (git && git !== 'clean' && git !== 'unknown' && git !== '') {
    return `  [${git} in git]`
  }
  const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0
  if (frecency >= HOT_FRECENCY) return '  [VERY often touched file]'
  if (frecency >= WARM_FRECENCY) return '  [often touched file]'
  return ''
}

export function formatGrepOutput(result) {
  if (!result.items?.length) return 'No matches found'
  const lines = []
  let currentFile = ''
  for (const match of result.items) {
    if (match.relativePath !== currentFile) {
      if (lines.length > 0) lines.push('')
      currentFile = match.relativePath
      lines.push(`${currentFile}${fffFileAnnotation(match)}`)
    }
    match.contextBefore?.forEach((line, i) => {
      const lineNum = match.lineNumber - match.contextBefore.length + i
      lines.push(` ${lineNum}- ${truncateLine(line)}`)
    })
    lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`)
    match.contextAfter?.forEach((line, i) => {
      const lineNum = match.lineNumber + 1 + i
      lines.push(` ${lineNum}- ${truncateLine(line)}`)
    })
  }
  return lines.join('\n')
}

function weakScoreThreshold(pattern) {
  const perfect = pattern.length * 12
  return Math.floor((perfect * 50) / 100)
}

export function formatFindOutput(result, limit, pattern) {
  if (!result.items?.length) {
    return { output: 'No files found matching pattern', weak: false, shownCount: 0 }
  }
  const topScore = result.scores?.[0]?.total ?? 0
  const weak = topScore < weakScoreThreshold(pattern)
  const effective = weak ? Math.min(FIND_WEAK_SAMPLE_SIZE, limit) : limit
  const shown = result.items.slice(0, effective)
  return {
    output: shown.map(item => `${item.relativePath}${fffFileAnnotation(item)}`).join('\n'),
    weak,
    shownCount: shown.length,
  }
}

/** Filter grep results to definition lines when definitions_only; fallback notice if none. */
export function applyDefinitionsOnly(result, definitionsOnly) {
  if (!definitionsOnly) return { result, notice: null }
  const defs = result.items.filter(m => m.isDefinition === true)
  if (defs.length > 0) {
    return {
      result: { ...result, items: defs, totalMatched: defs.length },
      notice: null,
    }
  }
  return {
    result,
    notice: 'No definition matches; showing all matches instead.',
  }
}
