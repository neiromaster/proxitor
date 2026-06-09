---
"proxitor": minor
---

Refactor CLI around `cmd-ts` features and add a `config show` command

- Replaced manual `argv` parsing (`isInfo`, `hasSubcommand`, `process.argv.slice(2)`) with `binary()` and a 4-line default-command prefix, so `proxitor --port 9000` behaves like `proxitor start --port 9000` and `--help` / `--version` are handled by the parser.
- Extracted the command tree to `src/cli-commands.ts` so tests can import `rootCli`, `startCommand`, and `configCli` without triggering the top-level `run()` invocation in `cli.ts`.
- Added `src/cli-types.ts` with custom cmd-ts `Type`s: `ConfigPath`, `OpenRouterKey`, `Port`, `NonEmptyString`, `AuthTypeCli` — all validated at parse time.
- Replaced the 20-line `resolveApiKey` / 4-source priority chain with `option({ env: 'OPENROUTER_API_KEY', type: OpenRouterKey })`. CLI flag → env var → `undefined` is now native cmd-ts precedence.
- Replaced the magic-string `err.message.includes('No config file found')` check with `instanceof MissingConfigError`. Added `tryFindConfigFile()` and `getConfigSearchPaths()` for proper discovery / error reporting.
- `start` now has aliases (`up`, `run`), `examples` (visible in `--help`), and validates port range / integer-ness at parse time.
- Replaced all 4 copies of `--config` / `--openrouter-key` declarations with one `configArgs` object spread across subcommands.
- Removed lazy `await import(...)` from every command handler in favor of static imports.
- `loadConfig` is now called exactly once per `start` invocation (was previously called twice via `resolveApiKey` + `withClient`).
- **`config show`**: new subcommand. Prints the resolved configuration (defaults + file + env + flags merged). Supports `--json` for machine-readable output. Masks `openrouterKey`.
- **`config list --json`**: now emits structured JSON `{ configPath, count, overrides: [...] }`.
- `wizard` now accepts `--config <path>` and forwards it to `askSaveLocation` so reconfiguration lands at the right file.
- New `vitest.config.ts` `define` for `__PROXITOR_VERSION__` (required by cmd-ts `--version` circuit breaker).
- 26 new unit tests + 13 new integration tests covering CLI dispatch, validation, `config show`, `config list --json`, and end-to-end proxy health.
- `src/cli.ts` is no longer excluded from coverage.
