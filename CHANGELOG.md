# Changelog

## 0.15.0

### Minor Changes

- 3ab6ad9: The model picker in `proxitor config browse` and `Add model override` is now fuzzy. Type abbreviations and out-of-order fragments — `claudops` → `anthropic/claude-opus`, `gpt4o` → `openai/gpt-4o`, `sonet` → `…/claude-…-sonnet` — and results rank by relevance, with consecutive and word-boundary matches (`/`, `-`, `_`, `.`, space) preferred over scattered interior ones. Previously the search required an exact, ordered substring, so typos and acronyms found nothing. No new dependencies; no config change required.

## 0.14.0

### Minor Changes

- 99eaded: `normalizeVolatileSystem` now also rewrites Claude Code's drifting `cc_version` build hash (preserving the readable semver), alongside the existing `cch` hash. Both churned bytes sit inside the cached prefix and invalidate it every turn for non-Anthropic providers (qwen/glm/etc.); collapsing `cc_version` keeps the cached prefix stable across turns. Opt-in — no config change required for existing users.

## 0.13.0

### Minor Changes

- 43d2261: Add `rewriteBlockTtl` (`auto` / `always` / `skip`, default `skip`): normalizes the TTL on the client's existing block-level `cache_control` breakpoints (`system`, `tools`, `messages[].content`) to match the configured `cacheControlTtl`. This fixes Anthropic rejecting requests where the root `ttl` is `1h` while Claude Code's block breakpoints stay at `5m` (mixed TTLs). It only rewrites breakpoints the client already placed (respects Anthropic's ≤4-breakpoint limit), reuses the `cacheControlTtl` value, and is opt-in. Set it from `proxitor config` → 💾 Caching → Activate caching (third step: mode → TTL → rewrite block TTLs), or per-model in the override editor; documented in the configuration reference.

## 0.12.0

### Minor Changes

- 19ed589: Unified Caching screen: `proxitor config cache` and a single 💾 Caching entry in
  the menu group the three caching levers (`cacheControl` + TTL, `sessionId`,
  `normalizeVolatileSystem`) on one screen with a live summary. Model-override
  editing is now instant-save and gains a per-model 💾 Caching submenu.
  `normalizeVolatileSystem` is now documented in the configuration reference.

## 0.11.0

### Minor Changes

- d7b7016: Add live config hot-reload: while the proxy runs, saving its config file is picked
  up automatically (polled via `fs.watchFile`) and applied to subsequent requests —
  no restart needed. Invalid edits keep the last valid config and log a clear error;
  the process never crashes. Tune cache settings (`cacheControl`, TTL,
  `normalizeVolatileSystem`, `modelOverrides`, provider routing) in one terminal and
  watch the effect on cache-hit logs in real time.

## 0.10.1

### Patch Changes

- 1cd08bc: The `normalizeVolatileSystem` flag (shipped in 0.10.0 as a global or per-model
  YAML option) is now settable per-model from the interactive wizard:

  - **`proxitor config add` / `edit`** — the add and edit override flows prompt
    for `normalizeVolatileSystem` (On / Off / Reset-inherit), mirroring the
    existing session/cache collectors, and show it in the proposed-override
    preview and current-config output.
  - The global `normalizeVolatileSystem` command now shares one On/Off/Reset
    prompt primitive with the per-model flow.
  - `proxitor.config.example.yaml` documents the per-model form.

## 0.10.0

### Minor Changes

- b0544cc: New opt-in tools to diagnose and stabilize prompt-cache behavior:

  - **Body-dump diagnostics** — set `PROXITOR_DUMP_BODY=1` to write one file per
    request (`<timestamp>_<model>_<reqId>.json`) containing the forwarded request
    body and the upstream cache usage (read/write/hit%). For offline prefix-cache
    analysis. Zero overhead when disabled.
  - **Normalize volatile system** — new `normalizeVolatileSystem` config flag
    (global or per-model override, also exposed in `proxitor config` under
    _Global Settings_) rewrites Claude Code's per-request `cch=…` hash in the
    system prompt to a constant, keeping the prefix cache byte-stable across
    turns for non-Anthropic providers (qwen/glm/etc.). Off by default.

  Internal: `parse-body` only parses `application/json` bodies; streaming
  responses no longer buffer fully in memory (O(1) rolling tail).

## 0.9.1

### Patch Changes

- d2097dc: Requests with query parameters (e.g. `?stream=true`) are now classified to the correct endpoint instead of falling back to `other`, restoring session-id fingerprinting and `cache_control` injection for query-bearing paths.

## 0.9.0

### Minor Changes

- af88022: Config menu: delete cache/session overrides + TTL `omit`/`never` model

  - `proxitor config edit` and the global `config cache-control` / `config session-routing` commands now support **Reset / inherit** — removes the field so the model inherits the global (or the global reverts to the schema default).
  - **`cacheControlTtl`** gains two explicit values:
    - `omit` — strips the `ttl` field from injected `cache_control`, guaranteeing no TTL (even a client-sent one).
    - `never` — passthrough: preserve the client `ttl`, add nothing, ignore an inherited value.
  - The ambiguous `cacheControlTtl: null` (model override) is **removed** — migrate to `never`. `null` was undocumented and unsettable from the UI.
  - TTL is now decoupled from cache mode in the editor: it can be set independently (it refines the inherited mode).
  - Clarified that `cacheControl` / `sessionId` `never` means passthrough (client headers left untouched), not stripping.

- 6b16b74: Add `cacheControl` and `sessionId` options for automatic prompt caching through OpenRouter

  - **`cacheControl`** (`auto`/`always`/`never`, default `auto`) — injects `cache_control: { "type": "ephemeral" }` to enable OpenRouter prompt caching. In `auto` mode, injection is endpoint-safe: `/v1/messages` and `/v1/responses` always get it; `/v1/chat/completions` only for Anthropic models (non-Anthropic providers may reject it with 400). Per-model overrides supported.
  - **`sessionId`** (`auto`/`always`/`never`, default `auto`) — injects `session_id` for provider sticky routing from the first request. In `auto` mode, uses the `X-Claude-Code-Session-Id` header if present; otherwise generates a proxy UUID to ensure sticky routing always works. Both `x-claude-code-session-id` and `x-session-id` client headers are stripped from forwarded requests.
  - Refactored body injection into `injectBodyFields()` returning `InjectionResult` with `effectiveSessionId` for consistent body/header session handling.
  - Extracted `computeInjection()` from `resolveRequest()` to reduce cognitive complexity.
  - `injectBodyFields` errors now fall back to forwarding the body as-is instead of returning 400.
  - `shouldInjectCacheControl` simplified — dead-code path branches removed.

- b63df3c: Add `cacheControlTtl` option for Anthropic prompt cache TTL control

  - **`cacheControlTtl`** (`'5m'` | `'1h'`, optional) — controls the cache time-to-live for Anthropic models. Without it, Anthropic's default 5-minute TTL applies. Set to `'1h'` for a 1-hour cache (2× write cost vs 1.25×, same 90% read discount). TTL is only injected for Anthropic models/endpoints — other providers don't support it.
  - **`null` in model overrides** — per-model `cacheControlTtl` accepts `null` to cancel a global TTL and revert to Anthropic's default behavior for specific models.
  - **Existing `cache_control` handling** — when the request body already contains `cache_control` without `ttl`, proxitor adds `ttl` if configured. If `ttl` is already present, it's preserved unchanged.

- 4dd5e55: Refactor CLI around `cmd-ts` features and add a `config show` command

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

  ### Wizard UX (Sprint 3)

  - **Custom listen address** — the host prompt now offers a "Custom address…" option accepting arbitrary IPs, hostnames, and `unix:/path` sockets.
  - **Upstream probe** — after collecting key, base URL, and auth type, the wizard performs a best-effort `GET /v1/models` (3 s timeout) against the configured upstream. Shows success (model count) or warning (unreachable / key rejected); never blocks the save.
  - **Progress markers** — each step shows `Step N/6` via `clack.log.step` for visual progress.
  - **Pre-filled reconfiguration** — when re-running the wizard with an existing config, all prompts are pre-filled with current values. Press Enter to keep, or type a new value.
  - **`maskKey` export** — now returns `(none)` for empty keys; exported for reuse in other commands.
  - **Reduced complexity** — extracted `collectAnswers` + `expectValue` (cancel-on-null sentinel) to bring `runWizard` cognitive complexity under the lint threshold.
  - 5 unit tests for `maskKey` + 4 integration tests covering happy path, custom host, cancel, and reconfigure scenarios.

- b63df3c: Remove dead code and simplify URL routing

  - **Breaking**: `openrouterBaseUrl` default changed from `https://openrouter.ai/api/v1` to `https://openrouter.ai/api` — incoming request paths (e.g. `/v1/chat/completions`) are now forwarded as-is instead of stripping `/v1`
  - **Breaking**: removed `extractModel`, `InjectionParams`, and `tryParseBody` from public API (unused after middleware refactor)
  - **Breaking**: removed `shouldInject` and `toUpstreamPath` from `src/proxy/paths.ts`
  - Added runtime warning when `openrouterBaseUrl` or `openrouterDataUrl` ends with `/v1` — helps catch configs from previous versions that would produce doubled paths like `/v1/v1/chat/completions`
  - Added `classifyEndpoint()` for centralized endpoint type detection, replacing scattered string comparisons across middleware
  - Added `tsc --noEmit` to pre-commit hook alongside biome
  - Added `config: ProxyConfig` to `ProxyVariables` context type (removed unsafe `as never` casts)
  - Data client paths updated to `/v1/providers`, `/v1/models`, `/v1/models/{author}/{slug}/endpoints`

- 4dd5e55: Add `proxitor doctor` diagnostic command and improve `config validate` output

  - **New `proxitor doctor` command** — runs a battery of checks and prints a report, intended as a first-aid tool for "why doesn't this work?". Sections: Environment (Node version, platform, TTY), Config discovery + validity, API key resolution, Network (upstream reachability, configurable timeout), Port availability, Version. Statuses: `ok` / `warn` / `fail` / `skip`. Exit code is `0` when no `fail`, `1` otherwise, so the command is scriptable from CI.
    - `--json` — emit machine-readable JSON instead of formatted text
    - `--offline` — skip network checks (upstream, npm)
    - `--timeout` — per-check network timeout in ms (default `3000`)
  - **`config validate` now returns exit code** — `0` on success, `1` on invalid config or no file. CI can use it as a gate.
  - **`config validate --json`** — structured `{ ok, configPath, keyCount | error, issues? }` output.
  - **`config validate` actionable advice** — on failure, lists each issue (path + message) and prints tips: open in `$EDITOR`, run `wizard`, or run `doctor`.
  - **`config edit` cleanup** — removed the dead "Replace entirely" option that pointed at the same handler as "Provider routing". Only provider routing is supported for now; the option was misleading.

  8 new tests in `tests/integration/doctor.test.ts` cover the no-config, valid-config, invalid-config, and offline paths, plus the JSON shape and exit code.

- b63df3c: Refactor proxy request processing into composable Hono middleware architecture

  - **Breaking**: removed `injectBodyFields`, `injectProvider`, `buildRequestHeaders`, and `InjectionResult` from public API
  - **Breaking**: session_id is now sent exclusively via `x-session-id` header instead of body injection (universal across all OpenRouter endpoints)
  - Decomposed monolithic proxy handler into 9 ordered middleware: setupRequest, readBody, parseBody, resolveConfig, injectProvider, injectCacheControl, injectSessionId, buildUpstreamReq, forwardRequest
  - Route-based middleware composition: injection middleware only registered on `/v1/chat/completions`, `/v1/responses`, `/v1/messages`; all other paths pass through without overhead
  - Eliminated double JSON parse — single parse in parseBody, in-place mutation by injection middleware, single serialize in buildUpstreamReq
  - Content-based session ID derivation for clients without session support: SHA-256 fingerprint of model + first system message + first user message gives stable per-conversation stickiness without cross-session pollution
  - Session ID sources (priority order): `x-claude-code-session-id` header (Claude Code) → `session_id` from body (Codex CLI) → content hash fingerprint → random UUID fallback
  - Shared `ProxyVariables` context type for type-safe data flow across middleware chain
  - Global `app.onError()` handler for unhandled errors

- f5beb28: Rename passthrough sentinel `never` → `skip`

  - The config value `never` (passthrough: leave the client value untouched, inject nothing) is renamed to `skip` across `cacheControl`, `sessionId`, and `cacheControlTtl`. `never` is no longer accepted — set `skip` instead. `omit` (strip) is unchanged.
  - `never` was temporal and clashed with its passthrough semantics; `skip` reads more clearly.

- b63df3c: Remove upstream request timeout — trust the upstream (OpenRouter) to enforce its own deadline and the client to cancel if it gives up.

  - **Breaking**: removed `upstreamTimeoutMs` config option (default was 5 minutes). The proxy no longer aborts upstream requests on its own timer; a slow OpenRouter response will stream as long as it takes, and Anthropic SSE generations of any length are no longer cut off mid-stream.
  - **Client cancellation** is still honored — when the client disconnects, the proxy aborts the upstream fetch and returns `499 Client Closed Request` (previously this surfaced as `500` via the global error handler).
  - **Network-level failures** (ECONNREFUSED, DNS, connection reset) still return `502 Bad Gateway` with `proxy_upstream_error` — the documented contract is preserved.

- f648798: Show base URL and auth type in the setup wizard preview

  The wizard's Preview note omitted `openrouterBaseUrl` and `authType` when they matched the defaults, so users couldn't see two values they had just chosen on steps 4–5. The preview now always shows a two-line header (Base URL + auth type, friendly label) above the YAML. The saved config file stays clean — defaults are still omitted. Auth option metadata is extracted into a shared `AUTH_OPTIONS` constant (DRY) reused by the auth prompt and the preview.

### Patch Changes

- 7eb186c: Fix cache_control TTL to use string format and add Responses API cache logging

  - **TTL fix**: `cache_control.ttl` now sends string values (`"5m"`, `"1h"`) instead of numeric seconds, matching the Anthropic and OpenRouter API spec
  - **Responses API SSE**: cache usage extraction now supports the `response` wrapper in SSE events (e.g. `response.completed`, `response.incomplete`), enabling cache logging for the `/v1/responses` endpoint
  - **Cache hit rate**: log messages now include hit rate percentage, e.g. `Cache read: 1088 tokens (90.0% hit)`
  - **Removed `TTL_SECONDS`** constant — no longer needed since TTL is passed as string

- 9a7da21: Make `doctor --timeout` optional so bare `proxitor doctor` works

  `--timeout` was declared as a required cmd-ts option, so every documented invocation — `proxitor doctor`, `proxitor doctor --offline`, `proxitor doctor --json` — failed at parse time with "No value provided for --timeout". The option is now optional, matching the built-in `DEFAULT_TIMEOUT_MS` fallback the handler already assumed.

- 06fe2c3: Show the app version in `doctor`'s version check

  The `version` check stored its value under `current`, which the text report formatter ignores (it reads `value`), so the report printed `✓ version` with no number. The version now lives on `value`, matching every other check, so the line reads e.g. `✓ version — 0.9.0-beta.9`.

- 4340696: Fix crash in `config add`/`edit` when a model has no provider endpoints

  Selecting a model without published endpoint data (e.g. OpenRouter aliases like `~anthropic/claude-sonnet-latest`) yielded zero providers and crashed the provider multiselect with "Cannot read properties of undefined (reading 'disabled')". `selectProvidersByMode` now bails with a warning instead of reaching the multiselect with an empty list.

- 733e966: Fix config menu stripping values that match defaults. Selected values are now always persisted to the config file, even when they equal the built-in defaults.
- 0b3c874: Simplify internal logic across modules and canonicalize upstream header casing

  - **Header canonicalization**: merged upstream request headers are now lowercased via a new pure `lowercaseKeys()` helper, so a case-variant header (e.g. a user-config `Content-Type` / `CONTENT-TYPE`) can no longer coexist with its lowercase form and corrupt the forwarded `content-type`. Fixes a latent bug where an odd-cased extra header produced a merged value like `text/xml, application/json` upstream.
  - **Pure header helpers**: `applyProxyHeaders`/`applyExtraHeaders`/`forceJsonContentType` rewritten as pure producers/transformers (`proxyHeaders`, `sanitizeExtraHeaders`, `withSessionId`, `withJsonContentType`) composed via object spread — no mutation or `delete`.
  - **CLI**: reuse `jsonFlag`, drop redundant `?? undefined`, extract `INFO_FLAGS`, collapse default-subcommand and `config`/`menu` injection logic.
  - **Config**: reuse `getConfigSearchPaths()` in `tryFindConfigFile`, simplify `cacheControlTtl` override normalization and `openrouterKey` resolution.
  - **OpenRouter data client**: drop redundant `OPENROUTER_FALLBACK_URL` alias, extract shared `isValidArrayDataResponse`, add missing-API-key guard in `probeUpstream`.
  - **Proxy utils/middleware**: simplify `cache-control`, `error`, `session-id`, and `forward-request` internals.
  - **Tests**: add `tests/unit/headers.test.ts` (AAA) and `tests/integration/header-casing.test.ts` regression.

- 27b133b: Simplify proxy module and config schema: remove dead re-exports, hoist per-request work out of /health, extract shared Zod schema helper, trim verbose comments

## 0.9.0-beta.12

### Patch Changes

- 06fe2c3: Show the app version in `doctor`'s version check

  The `version` check stored its value under `current`, which the text report formatter ignores (it reads `value`), so the report printed `✓ version` with no number. The version now lives on `value`, matching every other check, so the line reads e.g. `✓ version — 0.9.0-beta.9`.

## 0.9.0-beta.11

### Patch Changes

- 9a7da21: Make `doctor --timeout` optional so bare `proxitor doctor` works

  `--timeout` was declared as a required cmd-ts option, so every documented invocation — `proxitor doctor`, `proxitor doctor --offline`, `proxitor doctor --json` — failed at parse time with "No value provided for --timeout". The option is now optional, matching the built-in `DEFAULT_TIMEOUT_MS` fallback the handler already assumed.

## 0.9.0-beta.10

### Minor Changes

- f648798: Show base URL and auth type in the setup wizard preview

  The wizard's Preview note omitted `openrouterBaseUrl` and `authType` when they matched the defaults, so users couldn't see two values they had just chosen on steps 4–5. The preview now always shows a two-line header (Base URL + auth type, friendly label) above the YAML. The saved config file stays clean — defaults are still omitted. Auth option metadata is extracted into a shared `AUTH_OPTIONS` constant (DRY) reused by the auth prompt and the preview.

## 0.9.0-beta.9

### Patch Changes

- 4340696: Fix crash in `config add`/`edit` when a model has no provider endpoints

  Selecting a model without published endpoint data (e.g. OpenRouter aliases like `~anthropic/claude-sonnet-latest`) yielded zero providers and crashed the provider multiselect with "Cannot read properties of undefined (reading 'disabled')". `selectProvidersByMode` now bails with a warning instead of reaching the multiselect with an empty list.

## 0.9.0-beta.8

### Minor Changes

- f5beb28: Rename passthrough sentinel `never` → `skip`

  - The config value `never` (passthrough: leave the client value untouched, inject nothing) is renamed to `skip` across `cacheControl`, `sessionId`, and `cacheControlTtl`. `never` is no longer accepted — set `skip` instead. `omit` (strip) is unchanged.
  - `never` was temporal and clashed with its passthrough semantics; `skip` reads more clearly.

## 0.9.0-beta.7

### Minor Changes

- af88022: Config menu: delete cache/session overrides + TTL `omit`/`never` model

  - `proxitor config edit` and the global `config cache-control` / `config session-routing` commands now support **Reset / inherit** — removes the field so the model inherits the global (or the global reverts to the schema default).
  - **`cacheControlTtl`** gains two explicit values:
    - `omit` — strips the `ttl` field from injected `cache_control`, guaranteeing no TTL (even a client-sent one).
    - `never` — passthrough: preserve the client `ttl`, add nothing, ignore an inherited value.
  - The ambiguous `cacheControlTtl: null` (model override) is **removed** — migrate to `never`. `null` was undocumented and unsettable from the UI.
  - TTL is now decoupled from cache mode in the editor: it can be set independently (it refines the inherited mode).
  - Clarified that `cacheControl` / `sessionId` `never` means passthrough (client headers left untouched), not stripping.

## 0.9.0-beta.6

### Patch Changes

- 27b133b: Simplify proxy module and config schema: remove dead re-exports, hoist per-request work out of /health, extract shared Zod schema helper, trim verbose comments

## 0.9.0-beta.5

### Patch Changes

- 0b3c874: Simplify internal logic across modules and canonicalize upstream header casing

  - **Header canonicalization**: merged upstream request headers are now lowercased via a new pure `lowercaseKeys()` helper, so a case-variant header (e.g. a user-config `Content-Type` / `CONTENT-TYPE`) can no longer coexist with its lowercase form and corrupt the forwarded `content-type`. Fixes a latent bug where an odd-cased extra header produced a merged value like `text/xml, application/json` upstream.
  - **Pure header helpers**: `applyProxyHeaders`/`applyExtraHeaders`/`forceJsonContentType` rewritten as pure producers/transformers (`proxyHeaders`, `sanitizeExtraHeaders`, `withSessionId`, `withJsonContentType`) composed via object spread — no mutation or `delete`.
  - **CLI**: reuse `jsonFlag`, drop redundant `?? undefined`, extract `INFO_FLAGS`, collapse default-subcommand and `config`/`menu` injection logic.
  - **Config**: reuse `getConfigSearchPaths()` in `tryFindConfigFile`, simplify `cacheControlTtl` override normalization and `openrouterKey` resolution.
  - **OpenRouter data client**: drop redundant `OPENROUTER_FALLBACK_URL` alias, extract shared `isValidArrayDataResponse`, add missing-API-key guard in `probeUpstream`.
  - **Proxy utils/middleware**: simplify `cache-control`, `error`, `session-id`, and `forward-request` internals.
  - **Tests**: add `tests/unit/headers.test.ts` (AAA) and `tests/integration/header-casing.test.ts` regression.

## 0.9.0-beta.4

### Patch Changes

- 7eb186c: Fix cache_control TTL to use string format and add Responses API cache logging

  - **TTL fix**: `cache_control.ttl` now sends string values (`"5m"`, `"1h"`) instead of numeric seconds, matching the Anthropic and OpenRouter API spec
  - **Responses API SSE**: cache usage extraction now supports the `response` wrapper in SSE events (e.g. `response.completed`, `response.incomplete`), enabling cache logging for the `/v1/responses` endpoint
  - **Cache hit rate**: log messages now include hit rate percentage, e.g. `Cache read: 1088 tokens (90.0% hit)`
  - **Removed `TTL_SECONDS`** constant — no longer needed since TTL is passed as string

## 0.9.0-beta.3

### Patch Changes

- 733e966: Fix config menu stripping values that match defaults. Selected values are now always persisted to the config file, even when they equal the built-in defaults.

## 0.9.0-beta.2

### Minor Changes

- 4dd5e55: Refactor CLI around `cmd-ts` features and add a `config show` command

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

  ### Wizard UX (Sprint 3)

  - **Custom listen address** — the host prompt now offers a "Custom address…" option accepting arbitrary IPs, hostnames, and `unix:/path` sockets.
  - **Upstream probe** — after collecting key, base URL, and auth type, the wizard performs a best-effort `GET /v1/models` (3 s timeout) against the configured upstream. Shows success (model count) or warning (unreachable / key rejected); never blocks the save.
  - **Progress markers** — each step shows `Step N/6` via `clack.log.step` for visual progress.
  - **Pre-filled reconfiguration** — when re-running the wizard with an existing config, all prompts are pre-filled with current values. Press Enter to keep, or type a new value.
  - **`maskKey` export** — now returns `(none)` for empty keys; exported for reuse in other commands.
  - **Reduced complexity** — extracted `collectAnswers` + `expectValue` (cancel-on-null sentinel) to bring `runWizard` cognitive complexity under the lint threshold.
  - 5 unit tests for `maskKey` + 4 integration tests covering happy path, custom host, cancel, and reconfigure scenarios.

- 4dd5e55: Add `proxitor doctor` diagnostic command and improve `config validate` output

  - **New `proxitor doctor` command** — runs a battery of checks and prints a report, intended as a first-aid tool for "why doesn't this work?". Sections: Environment (Node version, platform, TTY), Config discovery + validity, API key resolution, Network (upstream reachability, configurable timeout), Port availability, Version. Statuses: `ok` / `warn` / `fail` / `skip`. Exit code is `0` when no `fail`, `1` otherwise, so the command is scriptable from CI.
    - `--json` — emit machine-readable JSON instead of formatted text
    - `--offline` — skip network checks (upstream, npm)
    - `--timeout` — per-check network timeout in ms (default `3000`)
  - **`config validate` now returns exit code** — `0` on success, `1` on invalid config or no file. CI can use it as a gate.
  - **`config validate --json`** — structured `{ ok, configPath, keyCount | error, issues? }` output.
  - **`config validate` actionable advice** — on failure, lists each issue (path + message) and prints tips: open in `$EDITOR`, run `wizard`, or run `doctor`.
  - **`config edit` cleanup** — removed the dead "Replace entirely" option that pointed at the same handler as "Provider routing". Only provider routing is supported for now; the option was misleading.

  8 new tests in `tests/integration/doctor.test.ts` cover the no-config, valid-config, invalid-config, and offline paths, plus the JSON shape and exit code.

## 0.9.0-beta.1

### Minor Changes

- b63df3c: Add `cacheControlTtl` option for Anthropic prompt cache TTL control

  - **`cacheControlTtl`** (`'5m'` | `'1h'`, optional) — controls the cache time-to-live for Anthropic models. Without it, Anthropic's default 5-minute TTL applies. Set to `'1h'` for a 1-hour cache (2× write cost vs 1.25×, same 90% read discount). TTL is only injected for Anthropic models/endpoints — other providers don't support it.
  - **`null` in model overrides** — per-model `cacheControlTtl` accepts `null` to cancel a global TTL and revert to Anthropic's default behavior for specific models.
  - **Existing `cache_control` handling** — when the request body already contains `cache_control` without `ttl`, proxitor adds `ttl` if configured. If `ttl` is already present, it's preserved unchanged.

- b63df3c: Remove dead code and simplify URL routing

  - **Breaking**: `openrouterBaseUrl` default changed from `https://openrouter.ai/api/v1` to `https://openrouter.ai/api` — incoming request paths (e.g. `/v1/chat/completions`) are now forwarded as-is instead of stripping `/v1`
  - **Breaking**: removed `extractModel`, `InjectionParams`, and `tryParseBody` from public API (unused after middleware refactor)
  - **Breaking**: removed `shouldInject` and `toUpstreamPath` from `src/proxy/paths.ts`
  - Added runtime warning when `openrouterBaseUrl` or `openrouterDataUrl` ends with `/v1` — helps catch configs from previous versions that would produce doubled paths like `/v1/v1/chat/completions`
  - Added `classifyEndpoint()` for centralized endpoint type detection, replacing scattered string comparisons across middleware
  - Added `tsc --noEmit` to pre-commit hook alongside biome
  - Added `config: ProxyConfig` to `ProxyVariables` context type (removed unsafe `as never` casts)
  - Data client paths updated to `/v1/providers`, `/v1/models`, `/v1/models/{author}/{slug}/endpoints`

- b63df3c: Refactor proxy request processing into composable Hono middleware architecture

  - **Breaking**: removed `injectBodyFields`, `injectProvider`, `buildRequestHeaders`, and `InjectionResult` from public API
  - **Breaking**: session_id is now sent exclusively via `x-session-id` header instead of body injection (universal across all OpenRouter endpoints)
  - Decomposed monolithic proxy handler into 9 ordered middleware: setupRequest, readBody, parseBody, resolveConfig, injectProvider, injectCacheControl, injectSessionId, buildUpstreamReq, forwardRequest
  - Route-based middleware composition: injection middleware only registered on `/v1/chat/completions`, `/v1/responses`, `/v1/messages`; all other paths pass through without overhead
  - Eliminated double JSON parse — single parse in parseBody, in-place mutation by injection middleware, single serialize in buildUpstreamReq
  - Content-based session ID derivation for clients without session support: SHA-256 fingerprint of model + first system message + first user message gives stable per-conversation stickiness without cross-session pollution
  - Session ID sources (priority order): `x-claude-code-session-id` header (Claude Code) → `session_id` from body (Codex CLI) → content hash fingerprint → random UUID fallback
  - Shared `ProxyVariables` context type for type-safe data flow across middleware chain
  - Global `app.onError()` handler for unhandled errors

- b63df3c: Remove upstream request timeout — trust the upstream (OpenRouter) to enforce its own deadline and the client to cancel if it gives up.

  - **Breaking**: removed `upstreamTimeoutMs` config option (default was 5 minutes). The proxy no longer aborts upstream requests on its own timer; a slow OpenRouter response will stream as long as it takes, and Anthropic SSE generations of any length are no longer cut off mid-stream.
  - **Client cancellation** is still honored — when the client disconnects, the proxy aborts the upstream fetch and returns `499 Client Closed Request` (previously this surfaced as `500` via the global error handler).
  - **Network-level failures** (ECONNREFUSED, DNS, connection reset) still return `502 Bad Gateway` with `proxy_upstream_error` — the documented contract is preserved.

## 0.9.0-beta.0

### Minor Changes

- 825fce6: Add `cacheControl` and `sessionId` options for automatic prompt caching through OpenRouter

  - **`cacheControl`** (`auto`/`always`/`never`, default `auto`) — injects `cache_control: { "type": "ephemeral" }` to enable OpenRouter prompt caching. In `auto` mode, injection is endpoint-safe: `/v1/messages` and `/v1/responses` always get it; `/v1/chat/completions` only for Anthropic models (non-Anthropic providers may reject it with 400). Per-model overrides supported.
  - **`sessionId`** (`auto`/`always`/`never`, default `auto`) — injects `session_id` for provider sticky routing from the first request. In `auto` mode, uses the `X-Claude-Code-Session-Id` header if present; otherwise generates a proxy UUID to ensure sticky routing always works. Both `x-claude-code-session-id` and `x-session-id` client headers are stripped from forwarded requests.
  - Refactored body injection into `injectBodyFields()` returning `InjectionResult` with `effectiveSessionId` for consistent body/header session handling.
  - Extracted `computeInjection()` from `resolveRequest()` to reduce cognitive complexity.
  - `injectBodyFields` errors now fall back to forwarding the body as-is instead of returning 400.
  - `shouldInjectCacheControl` simplified — dead-code path branches removed.

## 0.8.0

### Minor Changes

- 121778f: Log cache token usage from upstream responses (JSON and SSE)

  Both non-streaming and streaming responses now log cache hit/miss
  tokens so you can verify prompt caching without inspecting raw API
  responses. Supports Anthropic (`cache_read_input_tokens` /
  `cache_creation_input_tokens`) and OpenAI/OpenRouter
  (`prompt_tokens_details.cached_tokens` / `cache_write_tokens`)
  formats.

  Also updated:

  - App attribution header from `X-Title` to `X-OpenRouter-Title`
    (current recommended name per OpenRouter docs)
  - Default `attributionReferer` changed from `http://localhost` to
    `https://github.com/neiromaster/proxitor` so OpenRouter shows a
    proper app name instead of "http://localhost/"

## 0.7.0

### Minor Changes

- cdf54d1: Log cache token usage from upstream responses (JSON and SSE)

  Both non-streaming and streaming responses now log cache hit/miss
  tokens so you can verify prompt caching without inspecting raw API
  responses. Supports Anthropic (`cache_read_input_tokens` /
  `cache_creation_input_tokens`) and OpenAI/OpenRouter
  (`prompt_tokens_details.cached_tokens` / `cache_write_tokens`)
  formats.

  Also updated the app attribution header from `X-Title` to
  `X-OpenRouter-Title` (the current recommended name).

## 0.6.2

### Patch Changes

- 986b203: Log upstream error body (message, provider, raw) on 4xx/5xx responses

  Previously, error responses from upstream (400, 429, 500, etc.) were
  logged as status code and time only — the cause was invisible in logs.
  Now the proxy reads the error body and logs the extracted detail:

  - `error.code` and `error.message` from OpenRouter-style responses
  - `error.metadata.provider_name` — which provider caused the error
  - `error.metadata.raw` — the original provider error (most specific cause)

  4xx errors log at `warn` level, 5xx at `error` level.
  The full error body is still passed through to the client unchanged.

## 0.6.1

### Patch Changes

- 779405c: Fix log output to consistently left-align tags by disabling date/time in Consola format options, preventing timestamp position jumps between short and long log lines.

## 0.6.0

### Minor Changes

- 13de8af: Add request correlation ID to proxy logs and shorten upstream URL display

  - Each proxied request now gets a short 8-char hex ID (`[abcd1234]`) that appears in both the request (`→`) and response (`←`) log lines, making it easy to correlate concurrent requests
  - Strip `https://` from the upstream URL in request logs — the protocol is always the same, and the path is the important part
  - Add 29 comprehensive tests for `OpenRouterDataClient` fallback behavior (HTTP errors, network errors with retry, invalid response format, skipFallback mode, onFallback callback)

## 0.5.2

### Patch Changes

- 3335700: Add automatic fallback to OpenRouter for data endpoints (`/providers`, `/models`, `/models/*/endpoints`) when a custom API URL doesn't support them. Add `openrouterDataUrl` config option for explicit control over the primary data source. Move cache to `~/.cache/proxitor/` (XDG-compliant).

## 0.5.1

### Patch Changes

- ee51d73: Refactor configuration to use Zod `.default()` as the single source of truth. All default values now derive from the schema, eliminating duplicated constants across modules. Config validation now runs through Zod on the final merged result, and the wizard uses `readConfigFile` instead of manual YAML parsing.

## 0.5.0

### Minor Changes

- 6451604: Add OpenRouter API base URL prompt to setup wizard. The wizard now asks for `openrouterBaseUrl` (default `https://openrouter.ai/api/v1`), useful for self-hosted or custom OpenRouter endpoints. The field is omitted from config when the default is used.

### Patch Changes

- d5a0df2: Add PR template, issue templates (bug report, feature request), and contributing guide.

## 0.4.0

### Minor Changes

- 7276e5b: Add interactive setup wizard (`proxitor config wizard`) — creates or updates config with API key, port, host, and save location. Offers to launch automatically when no config is found. Change default port from 8080 to 8828.

## 0.3.0

### Minor Changes

- adb016a: Migrate CLI from `cac` to `cmd-ts` — type-safe args, native subcommands

  - Replaced `cac` with `cmd-ts` for type-driven CLI parsing
  - Added `start` and `config` as explicit subcommands (`proxitor start`, `proxitor config menu`)
  - `proxitor` without arguments still starts the proxy (backward compatible)
  - `--help` now shows both `start` and `config` subcommands
  - Config subcommands (`add`, `edit`, `remove`, `list`, `browse`, `validate`, `menu`) are routed natively
  - Provider lists are now sorted alphabetically
  - Model selection hints show input, output, and cache pricing
  - Removed `/1M` suffix from price formatting
  - `--help` no longer triggers dotenv injection

- 65010c4: Add interactive config manager (`proxitor config`) with @clack/prompts

  New `proxitor config` command with subcommands for managing model overrides
  through an interactive CLI instead of editing YAML by hand:

  - `config add` — search models with type-ahead autocomplete, fetch available
    providers from OpenRouter, select routing mode (only/order/ignore), and
    save to config with YAML comment preservation
  - `config edit` — modify provider routing for existing overrides
  - `config remove` — delete one or more overrides with confirmation
  - `config list` — display all current overrides
  - `config browse` — explore models with pricing, context length, latency,
    and throughput info; option to configure routing directly
  - `config validate` — check config file against Zod schema

  The interface uses live OpenRouter API data (models, endpoints, providers)
  with file-based caching. Model search uses @clack/prompts autocomplete with
  a dynamic options getter. Config writes preserve YAML comments via the `yaml`
  package.

- 725ed3a: Refactor config commands: extract shared modules, unify provider selection

  - **Alphabetical sorting**: Provider lists are now sorted alphabetically
    in both pattern (prefix) and specific model flows (add and edit)
  - **Unified provider selection**: The `order` routing mode now uses
    step-by-step sequential provider picking in both `config add` and
    `config edit`, not just `config add`
  - **Module split**: Extracted `shared.ts` into three domain-focused
    modules — `config.ts` (YAML operations), `format.ts` (display
    formatting), `providers.ts` (fetching and interactive selection)
  - **Complexity cleanup**: All cognitive complexity warnings resolved
    across `browse.ts`, `edit.ts`, and `list.ts`

- cded6a8: Add zod-based runtime config validation

  Config files are now validated at load time with clear error messages:

  - Unknown fields (typos like `porrt`) are caught and reported
  - Invalid values (negative ports, wrong enums, non-URL base URLs, negative prices) are rejected
  - Malformed YAML/JSON produces `ConfigParseError` with file path
  - Schema violations produce `ConfigValidationError` with field paths

  New exports: `ConfigParseError`, `ConfigValidationError`
  Added `zod` as a runtime dependency.

## 0.2.1

### Patch Changes

- 224c205: Fix upstream URL construction — buildUpstreamUrl now correctly parses request URL via new URL() instead of raw string concatenation, fixing proxy routing for all endpoints

## 0.2.0

### Minor Changes

- ca26014: Add Hono-based proxy with provider routing and SSE streaming

  Implements the core proxy server using Hono with:

  - Provider routing (OpenRouter, OpenAI, Anthropic)
  - SSE streaming support for real-time responses
  - Per-model config overrides with provider and header routing
  - Parse error cause restoration in injectProvider

- ca26014: Full OpenRouter provider support and runtime improvements

  - Complete OpenRouter provider field support
  - Graceful shutdown handling
  - dotenv integration for environment variables
  - Empty array filter for clean request payloads

- ca26014: XDG config directory support and --no-config CLI flag

  - Resolve config from XDG_CONFIG_HOME (~/.config/proxitor)
  - Support --no-config flag to skip config file loading
  - Priority: --config flag > current dir > XDG directory

### Patch Changes

- ca26014: Split CI/release workflows, add npm provenance, bump Node to 22+

  - Separate CI and Release GitHub Actions workflows
  - npm provenance via Trusted Publishing (OIDC)
  - Update GitHub Actions to v6
  - Drop EOL Node 20, test on Node 22 and 24
  - Fix tsdown dts option: resolve → resolver: 'tsc'

## 0.1.0

Initial release.
