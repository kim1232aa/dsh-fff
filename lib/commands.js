/**
 * Optional human slash commands (dsh-commands), mirroring Pi /fff-*.
 * Only registered when the `commands` service is present (TUI/web);
 * headless/ACP typically omit it — tools fff_health/fff_rescan remain.
 */
export function registerFffCommands(ctx, { core, getMode, setMode }) {
  if (typeof ctx.inject !== 'function') return

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'fff-health',
      description: 'Show FFF indexer health (version, files, git, DB, scan)',
      handler: async () => {
        const h = await core.health()
        return { kind: h.ok === false ? 'error' : 'success', text: h.text }
      },
    })

    commandCtx.commands.register({
      name: 'fff-rescan',
      description: 'Trigger FFF file rescan',
      handler: async () => {
        const r = await core.rescan()
        return { kind: r.ok ? 'success' : 'error', text: r.text }
      },
    })

    commandCtx.commands.register({
      name: 'fff-mode',
      description: 'Show or set FFF mode: tools-only | tools-and-ui | override',
      input: { hint: '[tools-only|tools-and-ui|override]' },
      handler: async ({ rawInput }) => {
        const arg = (rawInput || '').trim()
        const valid = ['tools-only', 'tools-and-ui', 'override']
        if (!arg) {
          return {
            kind: 'success',
            text: `Current mode: '${getMode()}' (tool name changes for override need profile reload + patches/override.yml)`,
          }
        }
        if (!valid.includes(arg)) {
          return { kind: 'error', text: `Usage: /fff-mode [${valid.join(' | ')}]` }
        }
        const old = getMode()
        setMode(arg === 'tools-and-ui' ? 'tools-only' : arg)
        if ((old === 'override') !== (arg === 'override')) {
          return {
            kind: 'success',
            text:
              `Mode '${arg}' recorded. Override renames tools to glob/grep/multi_grep and requires ` +
              `disabling tool-fs-search (patches/override.yml) then reloading the profile — dsh cannot hot-swap tool names mid-session like Pi /reload.`,
          }
        }
        return {
          kind: 'success',
          text: `Mode: '${old}' → '${arg}'${arg === 'tools-and-ui' ? ' (dsh: ≡ tools-only; no @ autocomplete API)' : ''}`,
        }
      },
    })
  })
}
