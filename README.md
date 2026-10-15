# dsh-fff

DeepSeek Harness plugin wrapping [`@ff-labs/fff-node`](https://www.npmjs.com/package/@ff-labs/fff-node) — fuzzy file find + content grep with a long-lived in-process index.

Port of local Pi extension [`@ff-labs/pi-fff`](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff) v0.11.0 (+ MCP `output_mode`). **Parity checklist:** [PARITY.md](./PARITY.md). Chinese docs: [README.zh-CN.md](./README.zh-CN.md).

## Tools

`fffind` · `ffgrep` · `fff-multi-grep` · `fff_health` · `fff_rescan` · `fff_track`

`ffgrep` / `fff-multi-grep` support MCP `outputMode`: `content` | `files_with_matches` | `count` | `usage`.

## Install

Do **not** use the `web` profile (port 3080):

```bash
dsh plugin --profile ffftest add file:/workspace/dsh-fff
```

Override built-in `glob`/`grep`: apply `patches/override.yml`.

## Test

```bash
npm test
```
