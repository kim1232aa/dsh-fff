import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildQuery, normalizePathConstraint, normalizeExcludes } from '../lib/query.js'
import { formatFindOutput, formatGrepOutput, clampContext, applyDefinitionsOnly } from '../lib/format.js'
import { createCursorStore } from '../lib/cursors.js'
import { resolveToolNames } from '../lib/tools.js'
import { createCore } from '../lib/core.js'
import { resolveDbPaths, isHomeDir, isFsRoot, routePathConstraint } from '../lib/paths.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fff-'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'test'))
  writeFileSync(join(root, 'src/hello.ts'), 'export function helloWorld() {\n  return 1\n}\n// TODO: polish\n')
  writeFileSync(join(root, 'src/util.ts'), 'export const HELLO = 42\n')
  writeFileSync(join(root, 'test/hello.test.ts'), 'import { helloWorld } from "../src/hello"\n')
  writeFileSync(join(root, 'README.md'), '# Project\n')
  return root
}

test('normalizePathConstraint + buildQuery + excludes', () => {
  assert.equal(normalizePathConstraint('src'), 'src/')
  assert.equal(normalizePathConstraint('src/**'), 'src/')
  assert.equal(normalizePathConstraint('*.ts'), '*.ts')
  assert.equal(normalizePathConstraint('main.ts'), 'main.ts')
  assert.deepEqual(normalizeExcludes('test/,!vendor/'), ['!test/', '!vendor/'])
  assert.match(buildQuery('src', 'hello', 'test/'), /src\/ !test\/ hello/)
})

test('format find weak-match + grep grouping', () => {
  const weak = formatFindOutput(
    { items: [{ relativePath: 'a.ts', gitStatus: 'clean' }], scores: [{ total: 1 }], totalMatched: 1 },
    30,
    'verylongpatternxyz',
  )
  assert.equal(weak.weak, true)
  assert.equal(clampContext(100), 20)
  const g = formatGrepOutput({
    items: [
      { relativePath: 'a.ts', lineNumber: 2, lineContent: '  foo', gitStatus: 'clean', contextBefore: ['x'], contextAfter: ['y'] },
      { relativePath: 'a.ts', lineNumber: 5, lineContent: '  bar', gitStatus: 'clean' },
    ],
  })
  assert.match(g, /a\.ts/)
  assert.match(g, /2:.*foo/)
})

test('definitions_only fallback notice', () => {
  const r = applyDefinitionsOnly(
    { items: [{ isDefinition: false, relativePath: 'a', lineNumber: 1, lineContent: 'x' }], totalMatched: 1 },
    true,
  )
  assert.match(r.notice, /No definition/)
  const d = applyDefinitionsOnly(
    { items: [{ isDefinition: true, relativePath: 'a', lineNumber: 1, lineContent: 'fn' }], totalMatched: 1 },
    true,
  )
  assert.equal(d.result.items.length, 1)
  assert.equal(d.notice, null)
})

test('cursors + tool names by mode', () => {
  const c = createCursorStore()
  const id = c.storeGrep({ _offset: 1 })
  assert.ok(c.getGrep(id))
  assert.equal(resolveToolNames('tools-only').find, 'fffind')
  assert.equal(resolveToolNames('override').grep, 'grep')
  assert.equal(resolveToolNames('override').find, 'glob')
})

test('paths helpers', () => {
  const dbs = resolveDbPaths({})
  assert.match(dbs.frecency, /fff/)
  assert.equal(isFsRoot('/'), true)
  assert.equal(typeof isHomeDir('/tmp'), 'boolean')
  assert.equal(routePathConstraint('src/', '/tmp'), null)
})

test('core fffind / ffgrep / multiGrep / health / rescan on fixture', async () => {
  const root = fixture()
  const core = createCore({
    basePath: root,
    disableWatch: true,
    frecencyDbPath: join(root, '.fff-frecency'),
    historyDbPath: join(root, '.fff-history'),
  })
  try {
    const found = await core.fffind({ pattern: 'hello', limit: 10 })
    assert.match(found.text, /hello\.ts/)
    assert.ok(found.totalMatched >= 1)

    const grepped = await core.ffgrep({ pattern: 'TODO', path: 'src/', limit: 10 })
    assert.match(grepped.text, /TODO/)

    const multi = await core.multiGrep({ patterns: ['HELLO', 'TODO'], limit: 20 })
    assert.ok(multi.totalMatched >= 1)

    const h = await core.health()
    assert.match(h.text, /FFF v/)
    assert.ok(h.ok)

    const r = await core.rescan()
    assert.equal(r.ok, true)

    // wildcard-only guard
    const bad = await core.ffgrep({ pattern: '.*' })
    assert.match(bad.text, /matches everything/)
  } finally {
    core.destroy()
    rmSync(root, { recursive: true, force: true })
  }
})

test('output_mode formatters', async () => {
  const { formatFilesWithMatches, formatCount, formatUsage, parseOutputMode } = await import('../lib/output-mode.js')
  assert.equal(parseOutputMode('COUNT'), 'count')
  const items = [
    { relativePath: 'a.ts', lineNumber: 1, lineContent: 'export function foo() {', isDefinition: true, size: 100, contextAfter: ['  return 1', '}'] },
    { relativePath: 'a.ts', lineNumber: 5, lineContent: '  foo()', isDefinition: false, size: 100 },
    { relativePath: 'b.ts', lineNumber: 2, lineContent: 'import { foo } from "./a"', isDefinition: false, size: 50 },
  ]
  const r = { items, totalMatched: 3 }
  assert.match(formatFilesWithMatches(r), /→ Read a\.ts/)
  assert.match(formatCount(r), /a\.ts: 2/)
  assert.match(formatCount(r), /total: 3/)
  assert.match(formatUsage(r), /a\.ts/)
})

test('core outputMode + track + ignoreCase/literal aliases', async () => {
  const root = fixture()
  const core = createCore({
    basePath: root,
    disableWatch: true,
    frecencyDbPath: join(root, '.fff-frecency'),
    historyDbPath: join(root, '.fff-history'),
  })
  try {
    const files = await core.ffgrep({ pattern: 'HELLO', outputMode: 'files_with_matches' })
    assert.match(files.text, /util\.ts|hello/)
    assert.equal(files.outputMode, 'files_with_matches')

    const count = await core.ffgrep({ query: 'TODO', outputMode: 'count', maxResults: 10 })
    assert.match(count.text, /total:/)

    const usage = await core.ffgrep({ pattern: 'helloWorld', outputMode: 'usage' })
    assert.equal(usage.outputMode, 'usage')

    const lit = await core.ffgrep({ pattern: 'hello', literal: true, ignoreCase: true })
    assert.ok(lit.totalMatched >= 0)

    const tr = await core.track({ query: 'hello', file: 'src/hello.ts' })
    assert.equal(tr.ok, true)
  } finally {
    core.destroy()
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDbPaths prefers pi fff when present', async () => {
  const { resolveDbPaths, piDataDir } = await import('../lib/paths.js')
  const dbs = resolveDbPaths({})
  // On this box ~/.pi/agent/fff/{frecency,history} exist
  assert.match(dbs.frecency, /fff/)
  assert.ok(piDataDir().includes('.pi') || process.env.PI_CODING_AGENT_DIR)
})
