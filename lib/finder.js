/**
 * Long-lived FileFinder + aux pool + health/rescan.
 * Process-in @ff-labs/fff-node (no MCP subprocess).
 */
import path from 'node:path'
import { FileFinder } from '@ff-labs/fff-node'
import { resolveDbPaths, isHomeDir, isFsRoot, routePathConstraint } from './paths.js'
import { buildQuery } from './query.js'

export const SCAN_TIMEOUT_MS = 15_000
export const MAX_AUX = 3
export const IDLE_TTL_MS = 5 * 60 * 1000

function rootCovers(root, target) {
  const r = path.resolve(root)
  const t = path.resolve(target)
  if (r === t) return true
  const rel = path.relative(r, t)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export class FinderRuntime {
  constructor(config = {}) {
    this.config = config
    this.basePath = path.resolve(config.basePath || process.cwd())
    this.dbs = resolveDbPaths(config)
    this.dbDisabled = false
    this.main = null
    this.mainPromise = null
    this.aux = []
    this.auxPending = new Map()
    this.enableFsRootScanning = config.enableFsRootScanning === true
    this.enableHomeDirScanning = config.enableHomeDirScanning !== false
    this.followSymlinks = config.followSymlinks !== false
    this.disableWatch = config.disableWatch === true
    this.disableContentIndexing = config.disableContentIndexing === true
    this._lastDbError = null
  }

  scanOptOutReason(cwd = this.basePath) {
    if (!this.enableHomeDirScanning && isHomeDir(cwd)) {
      return `cwd is $HOME and enableHomeDirScanning is false; FFF search disabled.`
    }
    if (!this.enableFsRootScanning && isFsRoot(cwd)) {
      return `cwd is filesystem root and enableFsRootScanning is false; FFF search disabled.`
    }
    return null
  }

  openPicker(basePath) {
    const init = {
      basePath,
      aiMode: true,
      enableHomeDirScanning: this.enableHomeDirScanning,
      enableFsRootScanning: this.enableFsRootScanning,
      followSymlinks: this.followSymlinks,
      disableWatch: this.disableWatch,
      disableContentIndexing: this.disableContentIndexing,
    }
    if (!this.dbDisabled) {
      const withDb = FileFinder.create({
        ...init,
        frecencyDbPath: this.dbs.frecency,
        historyDbPath: this.dbs.history,
      })
      if (withDb.ok) return withDb
      this._lastDbError = withDb.error
      const dbLess = FileFinder.create(init)
      if (dbLess.ok) {
        this.dbDisabled = true
        return dbLess
      }
      return withDb
    }
    return FileFinder.create(init)
  }

  async ensureMain(cwd) {
    const root = path.resolve(cwd || this.basePath)
    const optOut = this.scanOptOutReason(root)
    if (optOut) throw new Error(optOut)

    if (this.main && !this.main.isDestroyed && this.basePath === root) {
      return this.main
    }
    if (this.mainPromise) return this.mainPromise

    this.mainPromise = (async () => {
      if (this.main && !this.main.isDestroyed) {
        this.main.destroy()
        this.main = null
      }
      this.basePath = root
      const result = this.openPicker(root)
      if (!result.ok) throw new Error(`FFF init failed: ${result.error}`)
      this.main = result.value
      await this.main.waitForScan(SCAN_TIMEOUT_MS)
      return this.main
    })().finally(() => {
      this.mainPromise = null
    })
    return this.mainPromise
  }

  sweepAux(now = Date.now()) {
    const kept = []
    for (const e of this.aux) {
      if (now - e.lastUsed > IDLE_TTL_MS) {
        if (!e.finder.isDestroyed) e.finder.destroy()
      } else kept.push(e)
    }
    this.aux = kept
  }

  async acquireAux(root, { exact = false } = {}) {
    this.sweepAux()
    const want = path.resolve(root)
    let covering = null
    for (const e of this.aux) {
      if (e.finder.isDestroyed) continue
      if (exact ? e.root !== want : !rootCovers(e.root, want)) continue
      if (!covering || e.root.length > covering.root.length) covering = e
    }
    if (covering) {
      covering.lastUsed = Date.now()
      return { finder: covering.finder, root: covering.root }
    }

    const inflight = this.auxPending.get(want)
    if (inflight) {
      const e = await inflight
      e.lastUsed = Date.now()
      return { finder: e.finder, root: e.root }
    }

    const creation = (async () => {
      if (this.aux.length >= MAX_AUX) {
        let oldest = this.aux[0]
        for (const e of this.aux) if (e.lastUsed < oldest.lastUsed) oldest = e
        if (!oldest.finder.isDestroyed) oldest.finder.destroy()
        this.aux = this.aux.filter(e => e !== oldest)
      }
      const result = this.openPicker(want)
      if (!result.ok) throw new Error(`FFF aux picker failed for ${want}: ${result.error}`)
      await result.value.waitForScan(SCAN_TIMEOUT_MS)
      const entry = { root: want, finder: result.value, lastUsed: Date.now() }
      this.aux.push(entry)
      return entry
    })().finally(() => this.auxPending.delete(want))

    this.auxPending.set(want, creation)
    const entry = await creation
    return { finder: entry.finder, root: entry.root }
  }

  /**
   * Resolve finder + effective query for optional path/exclude.
   * Outside-workspace absolute/~/../ → aux picker.
   */
  async resolveForPath(pathParam, pattern, exclude) {
    const route = routePathConstraint(pathParam, this.basePath)
    if (!route) {
      const finder = await this.ensureMain(this.basePath)
      return {
        finder,
        query: buildQuery(pathParam, pattern, exclude, this.basePath),
        root: this.basePath,
        aux: false,
      }
    }
    const aux = await this.acquireAux(route.root)
    const rebase = path.relative(aux.root, route.root).replaceAll(path.sep, '/')
    const suffix = [rebase, route.suffix].filter(Boolean).join('/')
    return {
      finder: aux.finder,
      query: buildQuery(suffix || undefined, pattern, exclude, aux.root),
      root: aux.root,
      aux: true,
    }
  }

  health() {
    if (!this.main || this.main.isDestroyed) {
      return {
        ok: false,
        error: 'FFF not initialized',
        basePath: this.basePath,
        dbDisabled: this.dbDisabled,
        lastDbError: this._lastDbError,
        dbs: this.dbs,
      }
    }
    const h = this.main.healthCheck()
    const progress = this.main.getScanProgress?.()
    return {
      ok: h.ok,
      error: h.ok ? undefined : h.error,
      version: h.ok ? h.value.version : undefined,
      git: h.ok ? h.value.git : undefined,
      filePicker: h.ok ? h.value.filePicker : undefined,
      frecency: h.ok ? h.value.frecency : undefined,
      queryTracker: h.ok ? h.value.queryTracker : undefined,
      progress: progress?.ok ? progress.value : undefined,
      basePath: this.basePath,
      dbDisabled: this.dbDisabled,
      lastDbError: this._lastDbError,
      dbs: this.dbs,
      auxCount: this.aux.filter(e => !e.finder.isDestroyed).length,
    }
  }

  rescan() {
    if (!this.main || this.main.isDestroyed) {
      return { ok: false, error: 'FFF not initialized' }
    }
    const r = this.main.scanFiles()
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  destroy() {
    if (this.main && !this.main.isDestroyed) this.main.destroy()
    this.main = null
    for (const e of this.aux) {
      if (!e.finder.isDestroyed) e.finder.destroy()
    }
    this.aux = []
    this.auxPending.clear()
  }
}
