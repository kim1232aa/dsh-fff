/** Path/exclude → FFF query string (ported from @ff-labs/pi-fff). */
import path from 'node:path'

export function normalizePathConstraint(pathConstraint, cwd = process.cwd()) {
  let trimmed = pathConstraint.trim()
  if (!trimmed) return trimmed

  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(cwd, trimmed).replaceAll(path.sep, '/')
    if (relative === '') return null
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Path constraint must be relative to the workspace: ${pathConstraint}`)
    }
    trimmed = relative
  }

  if (trimmed === '.' || trimmed === './') return null
  if (trimmed.startsWith('./')) trimmed = trimmed.slice(2)
  if (trimmed === '**' || trimmed === '**/' || trimmed === '**/*') return null

  const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/)
  if (recursiveDir) {
    const dir = recursiveDir[1]
    if (dir && !/[*?[{]/.test(dir)) return `${dir}/`
  }

  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return trimmed
  if (/[*?[{]/.test(trimmed)) return trimmed
  const lastSegment = trimmed.split('/').pop() ?? ''
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) return trimmed
  return `${trimmed}/`
}

export function normalizeExcludes(exclude, cwd = process.cwd()) {
  if (!exclude) return []
  const list = Array.isArray(exclude) ? exclude : [exclude]
  const out = []
  for (const raw of list) {
    const parts = String(raw).split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    for (const p of parts) {
      const stripped = p.startsWith('!') ? p.slice(1) : p
      const normalized = normalizePathConstraint(stripped, cwd)
      if (normalized) out.push(`!${normalized}`)
    }
  }
  return out
}

export function buildQuery(pathParam, pattern, exclude, cwd = process.cwd()) {
  const parts = []
  if (pathParam) {
    const c = normalizePathConstraint(pathParam, cwd)
    if (c) parts.push(c)
  }
  parts.push(...normalizeExcludes(exclude, cwd))
  parts.push(pattern)
  return parts.join(' ')
}
