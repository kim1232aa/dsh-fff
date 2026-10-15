# Pi-fff vs dsh-fff measured compare

See [REPORT.md](./REPORT.md) for the full table and notes.

- `shots/` — side-by-side screenshots (left Pi, right dsh)
- `pi/` / `dsh/` — raw tool outputs per case
- `e2e/` — model-driven CLI runs (`dsh-gemini.txt` = ffftest + gemini-3.8-flash)
- `verdicts.json` / `cases.json` — machine-readable summary

No code change for multi-grep default in this push (still on by default in dsh; optional align later).
