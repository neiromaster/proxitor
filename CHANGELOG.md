# Changelog

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
