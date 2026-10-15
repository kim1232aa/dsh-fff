/** Model-facing tool specs for defineTool. */
import {
  DEFAULT_GREP_LIMIT,
  DEFAULT_FIND_LIMIT,
  GREP_CONTEXT_MAX,
} from './core.js'

const FFF_NAMES = {
  find: 'fffind',
  grep: 'ffgrep',
  multiGrep: 'fff-multi-grep',
  health: 'fff_health',
  rescan: 'fff_rescan',
  track: 'fff_track',
}

const OVERRIDE_NAMES = {
  find: 'glob',
  grep: 'grep',
  multiGrep: 'multi_grep',
  health: 'fff_health',
  rescan: 'fff_rescan',
  track: 'fff_track',
}

export function resolveToolNames(mode) {
  // tools-and-ui ≡ tools-only on dsh (no @ autocomplete surface)
  return mode === 'override' ? { ...OVERRIDE_NAMES } : { ...FFF_NAMES }
}

function textRender(_a, v) {
  return [{ type: 'text', text: typeof v === 'string' ? v : (v?.text ?? JSON.stringify(v)) }]
}

export function toolSpecs(core, config = {}) {
  const mode = config.mode === 'override' ? 'override' : 'tools-only'
  const names = resolveToolNames(mode)
  const t = config.tools ?? {}
  const specs = []

  const pathDesc =
    "Path constraint. Directory prefix (src/), bare filename (main.ts), or glob (*.ts, src/**/*.js). Absolute/~/../ outside workspace use a separate index."
  const excludeDesc =
    "Exclude paths (comma/space-separated or array). Same syntax as path; leading '!' optional. Example: 'test/,*.min.js,!vendor/'."

  if (t.find !== false) {
    specs.push({
      name: names.find,
      description: `Fuzzy path / glob search via FFF. Matches whole repo-relative path, frecency-ranked, git-aware. Multi-word = AND. Default limit ${DEFAULT_FIND_LIMIT}. Prefer over shell find.`,
      parameters: {
        pattern: {
          type: 'string',
          required: true,
          description:
            'Fuzzy filename/path query or glob. Multi-word narrows (AND). Prefer this for exploring named concepts/files.',
        },
        path: { type: 'string', description: pathDesc },
        exclude: {
          type: 'string',
          description: excludeDesc + ' (string or comma-separated; arrays accepted if the host passes them).',
        },
        limit: {
          type: 'integer',
          description: `Max results per page (default ${DEFAULT_FIND_LIMIT})`,
        },
        cursor: { type: 'string', description: 'Pagination cursor from previous result' },
      },
      output: { schema: { type: 'json' }, render: textRender },
      isConcurrencySafe: () => true,
      execute: (args, exec) => core.fffind(args, exec?.signal),
    })
  }

  if (t.grep !== false) {
    specs.push({
      name: names.grep,
      description: `Grep file contents via FFF. Smart-case, auto regex vs literal, frecency-ordered files, git-aware. Default limit ${DEFAULT_GREP_LIMIT}. Auto fuzzy fallback when no exact matches.`,
      parameters: {
        pattern: {
          type: 'string',
          required: true,
          description: 'Search pattern (literal text or regex). Prefer bare identifiers.',
        },
        path: { type: 'string', description: pathDesc },
        exclude: { type: 'string', description: excludeDesc },
        caseSensitive: {
          type: 'boolean',
          description:
            'Force case-sensitive. Default smart-case (insensitive when pattern is all lowercase).',
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Force case-insensitive (README alias; overrides smart-case).',
        },
        literal: {
          type: 'boolean',
          description: 'Force literal match (true) or allow regex (false). Default: auto-detect like Pi.',
        },
        context: {
          type: 'integer',
          description: `Context lines before+after each match (0-${GREP_CONTEXT_MAX})`,
        },
        limit: {
          type: 'integer',
          description: `Max matches (default ${DEFAULT_GREP_LIMIT})`,
        },
        cursor: { type: 'string', description: 'Pagination cursor from previous result' },
        outputMode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count', 'usage'],
          description:
            "Output format (MCP-aligned). content=lines (default); files_with_matches=paths+preview; count=per-file counts; usage=compact defs-first with char budget.",
        },
        definitionsOnly: {
          type: 'boolean',
          description:
            'Prefer matching declarations (fn/class/…). If none, report and show other matches.',
        },
      },
      output: { schema: { type: 'json' }, render: textRender },
      isConcurrencySafe: () => true,
      execute: (args, exec) => core.ffgrep(args, exec?.signal),
    })
  }

  if (t.multiGrep !== false) {
    specs.push({
      name: names.multiGrep,
      description:
        'Search file contents for ANY of multiple literal patterns (OR, SIMD Aho-Corasick). Faster than regex alternation. Include snake/camel/Pascal variants.',
      parameters: {
        patterns: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            'Literal patterns (OR). Include snake_case / camelCase / PascalCase variants.',
        },
        constraints: {
          type: 'string',
          description: "File filter, e.g. '*.{ts,tsx} !test/'",
        },
        context: {
          type: 'integer',
          description: `Context lines before+after (0-${GREP_CONTEXT_MAX})`,
        },
        limit: {
          type: 'integer',
          description: `Max matches (default ${DEFAULT_GREP_LIMIT})`,
        },
        cursor: { type: 'string', description: 'Pagination cursor' },
        outputMode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count', 'usage'],
          description:
            "Output format (MCP-aligned). content=lines (default); files_with_matches=paths+preview; count=per-file counts; usage=compact defs-first with char budget.",
        },
        definitionsOnly: {
          type: 'boolean',
          description: 'Prefer matching declarations when available.',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Force case-sensitive (default smart-case).',
        },
      },
      output: { schema: { type: 'json' }, render: textRender },
      isConcurrencySafe: () => true,
      execute: (args, exec) => core.multiGrep(args, exec?.signal),
    })
  }


  if (t.track !== false) {
    specs.push({
      name: names.track,
      description:
        'Record that a query led to selecting a file (FFF query-history / combo boost). Call after the agent picks a file from fffind/ffgrep results.',
      parameters: {
        query: { type: 'string', required: true, description: 'The search query that was used.' },
        file: {
          type: 'string',
          required: true,
          description: 'Selected file path (repo-relative or absolute under basePath).',
        },
      },
      output: { schema: { type: 'json' }, render: textRender },
      isConcurrencySafe: () => true,
      execute: (args, exec) => core.track(args, exec?.signal),
    })
  }

  if (t.health !== false) {
    specs.push({
      name: names.health,
      description:
        'Show FFF indexer health: version, indexed files, git, frecency/history DB status, scan progress.',
      parameters: {},
      output: { schema: { type: 'json' }, render: textRender },
      isConcurrencySafe: () => true,
      execute: (_args, exec) => core.health(exec?.signal),
    })
  }

  if (t.rescan !== false) {
    specs.push({
      name: names.rescan,
      description: 'Trigger FFF to rescan files under the indexed basePath.',
      parameters: {},
      output: { schema: { type: 'json' }, render: textRender },
      isConcurrencySafe: () => false,
      execute: (_args, exec) => core.rescan(exec?.signal),
    })
  }

  return specs
}
