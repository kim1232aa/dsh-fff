/** DB path resolution + home/root helpers (aligned with @ff-labs/pi-fff). */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME_DIR = path.resolve(os.homedir())

export function isHomeDir(dir) {
  return path.resolve(dir) === HOME_DIR
}

export function isFsRoot(dir) {
  const resolved = path.resolve(dir)
  return path.dirname(resolved) === resolved
}

function nvimCacheDir() {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg) return path.join(xdg, 'nvim')
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'nvim-data', 'cache')
  }
  return path.join(HOME_DIR, '.cache', 'nvim')
}

function nvimDataDir() {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg) return path.join(xdg, 'nvim')
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'nvim-data')
  }
  return path.join(HOME_DIR, '.local', 'share', 'nvim')
}

/** Same default as pi (`PI_CODING_AGENT_DIR` or ~/.pi/agent). */
export function piDataDir() {
  return process.env.PI_CODING_AGENT_DIR || path.join(HOME_DIR, '.pi', 'agent')
}

function dshDataDir() {
  const home = process.env.DSH_HOME || path.join(HOME_DIR, '.dsh')
  return path.join(home, 'fff')
}

function existingDir(parent, name) {
  const candidate = path.join(parent, name)
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolution (each path independent), matching pi-fff + dsh fallback:
 * 1. Config override (frecencyDbPath / historyDbPath)
 * 2. Env FFF_FRECENCY_DB / FFF_HISTORY_DB
 * 3. Existing fff.nvim DB dirs
 * 4. Existing ~/.pi/agent/fff/{frecency,history} (share Pi sessions)
 * 5. ~/.dsh/fff/{frecency,history} (created on demand by native layer)
 */
export function resolveDbPaths(overrides = {}) {
  const frecency =
    overrides.frecencyDbPath ||
    process.env.FFF_FRECENCY_DB ||
    existingDir(nvimCacheDir(), 'fff_nvim') ||
    existingDir(path.join(piDataDir(), 'fff'), 'frecency') ||
    path.join(dshDataDir(), 'frecency')
  const history =
    overrides.historyDbPath ||
    process.env.FFF_HISTORY_DB ||
    existingDir(nvimDataDir(), 'fff_queries') ||
    existingDir(path.join(piDataDir(), 'fff'), 'history') ||
    path.join(dshDataDir(), 'history')
  return { frecency, history }
}

/** Absolute / ~/ / ../ outside cwd → separate aux root; else null (use main). */
export function routePathConstraint(pathParam, cwd) {
  if (!pathParam || !pathParam.trim()) return null
  let raw = pathParam.trim()
  if (raw.startsWith('~/') || raw === '~') {
    raw = path.join(HOME_DIR, raw.slice(2) || '')
  }
  if (!path.isAbsolute(raw) && !raw.startsWith('../') && raw !== '..') return null

  const abs = path.resolve(cwd, raw)
  const rel = path.relative(cwd, abs)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return null

  let root = abs
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) root = path.dirname(abs)
  } catch { /* ignore */ }
  if (!fs.existsSync(root)) {
    let cur = root
    while (cur !== path.dirname(cur) && !fs.existsSync(cur)) cur = path.dirname(cur)
    root = cur
  }
  const suffix = path.relative(root, abs).replaceAll(path.sep, '/')
  return { root, suffix: suffix === '' ? undefined : suffix }
}
