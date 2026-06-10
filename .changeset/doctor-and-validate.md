---
"proxitor": minor
---

Add `proxitor doctor` diagnostic command and improve `config validate` output

- **New `proxitor doctor` command** — runs a battery of checks and prints a report, intended as a first-aid tool for "why doesn't this work?". Sections: Environment (Node version, platform, TTY), Config discovery + validity, API key resolution, Network (upstream reachability, configurable timeout), Port availability, Version. Statuses: `ok` / `warn` / `fail` / `skip`. Exit code is `0` when no `fail`, `1` otherwise, so the command is scriptable from CI.
  - `--json` — emit machine-readable JSON instead of formatted text
  - `--offline` — skip network checks (upstream, npm)
  - `--timeout` — per-check network timeout in ms (default `3000`)
- **`config validate` now returns exit code** — `0` on success, `1` on invalid config or no file. CI can use it as a gate.
- **`config validate --json`** — structured `{ ok, configPath, keyCount | error, issues? }` output.
- **`config validate` actionable advice** — on failure, lists each issue (path + message) and prints tips: open in `$EDITOR`, run `wizard`, or run `doctor`.
- **`config edit` cleanup** — removed the dead "Replace entirely" option that pointed at the same handler as "Provider routing". Only provider routing is supported for now; the option was misleading.

8 new tests in `tests/integration/doctor.test.ts` cover the no-config, valid-config, invalid-config, and offline paths, plus the JSON shape and exit code.
