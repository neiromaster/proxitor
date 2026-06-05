# Changelog

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
