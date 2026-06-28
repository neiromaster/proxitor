# Configuration reference

🌍 **English** · [Русский](./configuration.ru.md)

This is the full reference for configuring proxitor by hand. If you prefer not to edit files, the interactive menu (`proxitor config`) covers most of this — and uses live OpenRouter data. See the [README](../README.md) for the quick start.

A commented template lives at [`proxitor.config.example.yaml`](../proxitor.config.example.yaml).

## Where the config lives

Proxitor looks for a config file in this order:

```
proxitor.config.yaml  →  proxitor.config.yml  →  proxitor.config.json
.proxitor.yaml        →  .proxitor.yml         →  .proxitor.json
```

**Priority:** CLI flags > config file > environment variables > defaults.

## Authentication type

By default, proxitor sends the API key as a `Bearer` token (`Authorization: Bearer sk-...`). For a custom proxy provider that expects an `OAuth` header instead, set `authType` to `oauth`:

```yaml
authType: oauth    # "bearer" (default) or "oauth"
```

This changes the header to `Authorization: OAuth sk-...`.

## Custom API URL and data fallback

When using a custom `openrouterBaseUrl` that points to a third-party service, that service may not support OpenRouter-specific endpoints like `/providers` or `/models/{author}/{slug}/endpoints`. Proxitor handles this automatically:

- **Automatic fallback** — if the custom API returns an error (4xx/5xx) or an unexpected response format for data endpoints, proxitor falls back to `https://openrouter.ai/api` (no API key needed — these endpoints are public).
- **`openrouterDataUrl`** — set this explicitly to control the primary URL for data fetching, independent of `openrouterBaseUrl` (which is used for proxying requests).

```yaml
# Proxy requests go to custom service, data fetching falls back to OpenRouter.
# NOTE: do NOT include /v1 in the base URL — request paths like /v1/chat/completions
# are forwarded as-is, so /v1 would be duplicated if included here.
openrouterBaseUrl: 'https://custom-service.example.com/api'

# Explicitly set the primary data URL (optional, defaults to openrouterBaseUrl).
# openrouterDataUrl: 'https://openrouter.ai/api'
```

When a fallback occurs, proxitor logs a warning: `Custom API did not return providers, using OpenRouter as fallback`.

## Provider routing

Control which provider handles your requests. All three options accept a string or an array:

```yaml
# Strict lock — only this provider, no fallbacks
provider:
  only: "anthropic"

# Restricted pool — load balance between these providers only
provider:
  only:
    - "anthropic"
    - "deepinfra"

# Priority order — try Anthropic first, fall back to others if unavailable
provider:
  order: "anthropic"
  allowFallbacks: true

# Strict order — try in sequence, no fallbacks outside the list
provider:
  order:
    - "anthropic"
    - "deepinfra"
  allowFallbacks: false

# Blacklist — never use these providers
provider:
  ignore: "azure"
```

| Option | Behavior |
|---|---|
| `only` | Restrict to the listed provider(s). Load balances by price within the list. Never routes outside it — if all are unavailable, the request fails. |
| `order` | Try providers in the specified priority order. If none work, falls back to other available providers (unless `allowFallbacks: false`). |
| `ignore` | Never route to the listed provider(s). |

Without `provider` set, requests are forwarded unchanged.

See [OpenRouter's provider routing docs](https://openrouter.ai/docs/guides/routing/provider-selection) for the full list of supported providers and options.

### Advanced provider options

```yaml
provider:
  sort: "throughput"          # sort by: price | throughput | latency
  quantizations:
    - "fp8"                   # filter by quantization level
  maxPrice:
    prompt: 1                 # $/M tokens
    completion: 2
  requireParameters: true     # only use providers that support all request params
  dataCollection: "deny"      # "allow" | "deny"
  zdr: true                   # Zero Data Retention enforcement
  preferredMinThroughput:
    p90: 50                   # tokens/sec (soft threshold)
  preferredMaxLatency:
    p90: 3                    # seconds (soft threshold)
```

## Per-model overrides

Route different models differently. Keys are exact names or prefix wildcards. More specific matches win.

```yaml
provider:
  order: "deepinfra"   # global default

modelOverrides:
  # Exact match — force this model to Anthropic
  "claude-sonnet-4-6":
    provider:
      only: "anthropic"

  # Wildcard — all claude-* models prefer Anthropic with fallback
  "claude-*":
    provider:
      order:
        - "anthropic"
        - "deepinfra"

  # GPT models to OpenAI/Azure, plus a custom header
  "gpt-*":
    provider:
      only:
        - "openai"
        - "azure"
    headers:
      X-Model-Family: "gpt"
```

**Match priority:** full exact name > prefix wildcard > slug match (bare name ↔ vendor-prefixed) > slug prefix.

A model name matches with or without its vendor prefix: the bare `kimi-k2.6` matches the override key `moonshotai/kimi-k2.6`. A dated or variant slug needs an explicit `*` — `moonshotai/kimi-k2.6-20260420` matches `moonshotai/kimi-k2.6*`, not the bare `moonshotai/kimi-k2.6` key — so `gpt-4` never captures `gpt-4o`. The vendor prefix distinguishes vendors: `openai/gpt-4o` matches the bare `gpt-4o` but never another vendor's `azure/gpt-4o`. The incoming model name is forwarded upstream unchanged.

> **Same-slug collisions:** if several override keys share a model name across vendors (e.g. `openai/gpt-4o` and `azure/gpt-4o`) and Claude Code sends the bare name, proxitor resolves it to one key — a bare override key if present, otherwise the first-declared vendor-prefixed one (the warning names it). `proxitor` warns once at startup and in `proxitor doctor`; send the vendor-prefixed name to pick a specific one.

## Custom headers

Add headers to all proxied requests, or per-model (merged on top of global):

```yaml
headers:
  X-Custom-Header: "my-value"
  X-Environment: "production"

modelOverrides:
  "claude-*":
    headers:
      X-Custom-Header: "claude-override"  # overrides the global value
      X-Extra: "only-for-claude"          # added only for this model
```

## Prompt caching

Prompt caching is **provider-scoped**: a cache built on Anthropic doesn't help when the next request lands on another provider. Three request-shaping settings make caching survive across requests. Think of them as **levers** — most setups need only the first two.

| Lever | Field | Default | What it does |
| --- | --- | --- | --- |
| **Activate caching** | `cacheControl` | `auto` | Injects `cache_control` so the upstream caches the prompt (Anthropic-native providers) |
| **Pin the provider** | `sessionId` | `auto` | Injects `session_id` so routing sticks from the first request — no provider flip-flop that resets the cache |
| **Stabilize the prefix** | `normalizeVolatileSystem` | `false` | Strips Claude Code's volatile `cch` and `cc_version` hashes from the system prompt so the prefix stops churning (non-Anthropic providers) |

**Rule of thumb:** Anthropic models need levers **1+2**; non-Anthropic providers (qwen / glm / etc. behind Claude Code) need **all three**.

`cacheControlTtl` (below) is a sub-option of lever 1 — it controls the injected `cache_control.ttl`, not a separate lever.

**`cacheControl`** — injects `cache_control: { "type": "ephemeral" }` into the request body. OpenRouter uses this to set cache breakpoints and advance them as conversations grow.

**`cacheControlTtl`** (`5m` / `1h` / `omit` / `skip`, default absent = passthrough) — controls the `ttl` field on injected `cache_control` (Anthropic endpoints only). TTL only has effect when caching is active (`cacheControl` is `auto`/`always`); it is set independently of the cache mode in the editor.

**`rewriteBlockTtl`** (`auto` / `always` / `skip`, default `skip`) — normalizes the `ttl` on the **block-level** `cache_control` breakpoints the client already placed (in `system`, `tools`, `messages[].content`) so they match `cacheControlTtl`. Claude Code sends these blocks mostly without a `ttl` (Anthropic then treats them as `5m`); if you set `cacheControlTtl: 1h`, the request leaves the proxy with a `1h` root and `5m` blocks — mixed TTLs that Anthropic rejects. `rewriteBlockTtl` fixes that.

| Mode | Behavior |
| --- | --- |
| `skip` (default) | Leave the client's block `ttl` untouched. The mismatch can still occur — set this only if you want the client to own block TTLs. |
| `auto` | Rewrite block TTLs to `cacheControlTtl` on Anthropic-native endpoints (when caching is active). |
| `always` | Rewrite block TTLs on all endpoints. |

It reuses the value of `cacheControlTtl` (`5m` / `1h` / `omit`) and only touches **existing** breakpoints — it adds none, so Anthropic's ≤4-breakpoint limit and the client's placement are respected. Set it from `proxitor config` → **💾 Caching** → Activate caching → *Rewrite block TTLs* (the third step: mode → TTL → rewrite), or per-model in the override editor.

> **Note:** setting `cacheControlTtl: 1h` alone does **not** fix the mismatch — `rewriteBlockTtl` must also be `auto` or `always`.

```yaml
cacheControl: auto
cacheControlTtl: 1h
rewriteBlockTtl: auto   # normalize block breakpoints to 1h (fixes Anthropic mixed-ttl rejection)

modelOverrides:
  "claude-opus-*":
    rewriteBlockTtl: skip   # leave Opus block TTLs as the client sends them
```

**`normalizeResponses`** (`true` / `false`, default `true`) — repairs `/v1/responses` bodies so they satisfy OpenRouter's strict `input` schema. OpenRouter validates each `input` item as a union discriminated by `type`; clients that omit `type` on message items (legal on OpenAI, which infers `message`) get `400 invalid_prompt | Invalid Responses API request`. The normalizer:

- tags role-bearing items lacking `type` with `type: "message"`;
- lifts `role: "system"` items into the top-level `instructions` field (OpenRouter Responses has no system role in `input`);
- synthesizes the `id` / `status` OpenRouter requires on assistant history items.

It is idempotent, only touches items that need it, and acts on `/v1/responses` only. Off (`false`) is raw passthrough (such client requests then fail at OpenRouter). Set per-model in the override editor.

**`normalizeMessages`** (`true` / `false`, default `false`) — lifts stray `role:"system"` items out of the `messages` array on `/v1/messages`. The Anthropic Messages API allows only `user`/`assistant` in `messages`; a mid-thread `role:"system"` (e.g. an injected `SessionStart` hook payload) is rejected by strict Anthropic-format providers (OpenRouter → GLM and others) with `400 ... messages[n].role: Input should be 'user' or 'assistant'`. The normalizer:

- moves each system item's text into the top-level `system` field (string stays a string, a block array gets a new `{type:"text"}` block appended);
- drops the item from `messages`, which also preserves `user`/`assistant` alternation;
- drops system items whose content has no extractable text.

It is idempotent and acts on `/v1/messages` only — the lift is never valid on chat-completions (where `system` belongs in `messages`) or responses, so it is gated by endpoint regardless of the setting. Off by default; enable globally or per-model in the override editor.

**`sessionId`** — injects `session_id` for provider sticky routing. Without it, OpenRouter only pins to a provider after detecting a cache hit. With it, routing sticks from the **first request** — critical for OpenAI models where delayed caching means 0 cached tokens on the first 1-2 requests.

Both `cacheControl` and `sessionId` support `auto` / `always` / `skip` modes:

| Mode | `cacheControl` | `sessionId` |
| --- | --- | --- |
| `auto` (default) | Anthropic models on `/v1/chat/completions`; all models on `/v1/messages` and `/v1/responses` | Passthrough client session ID if present; otherwise generate proxy UUID |
| `always` | All models, all endpoints | Always generate proxy session ID, ignoring client-provided |
| `skip` | Passthrough: leave the client's `cache_control` untouched and inject nothing | Passthrough: leave client session headers untouched |

`cacheControlTtl` values:

| Value | TTL | Write cost | Use when |
| --- | --- | --- | --- |
| _(absent)_ | Passthrough: preserve client `ttl`, add nothing; per-model absent inherits the global TTL | — | Default |
| `5m` | 5 minutes (Anthropic default) | 1.25× | Explicit short cache; high-frequency requests (>1 per 5 min) |
| `1h` | 1 hour | 2.0× | Low-frequency or long-running sessions |
| `omit` | Strip the `ttl` field, guaranteeing no TTL (even one sent by the client) | — | Force-disable TTL |
| `skip` | Passthrough: preserve the client's `ttl`, add nothing, ignore an inherited value | — | Ignore global TTL without stripping |

> **Note:** `null` (previously accepted in model overrides to cancel an inherited TTL) is **removed** — migrate to `skip`. `null` was undocumented and unsettable from the UI.

```yaml
cacheControl: auto    # safe default — Anthropic and safe endpoints only
sessionId: auto       # always ensures sticky routing (client header or proxy UUID)

# Use 1-hour cache for all Anthropic models (higher write cost, longer TTL)
cacheControlTtl: 1h

# Force caching for all models (may cause 400 on non-Anthropic /v1/chat/completions)
# cacheControl: always

# Per-model overrides — TTL supports '5m', '1h', 'omit', or 'skip' (passthrough)
modelOverrides:
  "gpt-*":
    cacheControl: skip        # OpenAI caches automatically, no injection needed
    sessionId: always         # but sticky routing still helps
  "claude-opus-*":
    cacheControlTtl: skip     # passthrough for Opus — ignore the global 1h TTL, use the client ttl
```

**Why the levers matter:**

- **Anthropic models** — lever 1 (`cache_control`) activates caching, `cacheControlTtl` extends it beyond 5 min, lever 2 (`session_id`) prevents the provider flip-flop that would invalidate it.
- **OpenAI models** — caching is automatic (no lever 1 needed), but lever 2 (`session_id`) ensures sticky routing from request #1 instead of waiting for a cache hit.
- **Non-Anthropic models behind Claude Code (qwen / glm / …)** — lever 3 (`normalizeVolatileSystem`) stabilizes the prefix; without it the churned `cch`/`cc_version` hashes prevent the prefix cache from ever warming.
- **All models** — lever 2 (`session_id`) prevents the provider switch that silently resets the cache.

## Cache observability

While proxitor runs, it prints a **classified per-request cache line** for every proxied response (non-streaming JSON and streaming SSE) so you can see at a glance whether caching is actually helping. No configuration is needed — it's on by default.

```
[a1b2] HIT   99%  read 48640  in 48874  glm-4.5-air  [main]
[c3d4] PARTIAL  42%  read 1088  in 2600  provider=anthropic  claude-sonnet-4-6  [side]
[e5f6] MISS   in 48874  provider=novita  glm-4.5-air  [main]
[g7h8] COLD   in 48874  glm-4.5-air  [main]
[i9j0] NOUSAGE   claude-sonnet-4-6  [main]
```

Each line carries the request ID, the **label**, the hit percentage (for `HIT`/`PARTIAL`), `read N` / `write N` tokens where present, `in N` input tokens, `provider=…` when routing metadata is available, the model, and the request type `[main]`/`[side]`. (`read N` only appears when there is a non-zero cache read, so `MISS`/`COLD` lines omit it.)

### Labels

| Label | Meaning |
| --- | --- |
| `HIT` | Cache read ≥ `hitThreshold`% of input tokens — a warm, useful cache. |
| `PARTIAL` | Some cache read, but below the threshold. |
| `MISS` | No cache read on a **repeat** request in the same session — the cache should have served it but didn't. |
| `COLD` | No cache read on the **first** request in a session — the expected one-time warm-up cost. |
| `NOUSAGE` | No usage object was observed (non-logged content type, malformed response, etc.). |

### Request type

Each request is tagged `[main]` or `[side]`. A request is `[side]` only when it has **no tools** and its `max_tokens` is at or under `sideMaxTokens` — a two-signal rule that avoids mislabeling small tool-less lookups as the main turn. Everything else is `[main]`.

**`max_tokens` resolution:** the budget uses `max_tokens ?? max_completion_tokens`. When neither is present, the request defaults to `[main]` (fail-safe) rather than `[side]`.

### Configuration

All options live under `observability:` and are optional with sensible defaults.

```yaml
observability:
  routerMetadata: true      # send x-openrouter-metadata to surface the serving provider
  hitThreshold: 80          # cacheRead/inputTokens % at or above => HIT
  sideMaxTokens: 4096       # tool-less request with max_tokens <= this => [side]
  sessionMaxEntries: 4096   # in-memory session-tracker capacity (FIFO eviction)
  sessionTtlMs: 600000      # session-tracker entry TTL (10 minutes)
```

| Option | Default | Description |
| --- | --- | --- |
| `routerMetadata` | `true` | Opts the proxy into OpenRouter's `x-openrouter-metadata` so responses surface which provider actually served the request (shown as `provider=…` on the cache line whenever routing/serving-provider metadata is available). Set `false` to opt out. |
| `hitThreshold` | `80` | The `cacheRead / inputTokens` percentage at or above which a request is labeled `HIT`. |
| `sideMaxTokens` | `4096` | A request with **no tools** AND `max_tokens` at or under this budget is tagged `[side]`. |
| `sessionMaxEntries` | `4096` | Bounded capacity of the in-memory session tracker (FIFO eviction when exceeded). |
| `sessionTtlMs` | `600000` | Session-tracker entry time-to-live (10 minutes). |

### Enriched dumps

Set `PROXITOR_DUMP_BODY=1` to write request/response dumps (to `~/.cache/proxitor/dumps`, overridable via `PROXITOR_DUMP_DIR`). When enabled, the `response` object in each dump is enriched with the classified observation:

```json
"response": {
  "status": 200,
  "label": "HIT",
  "requestType": "main",
  "model": "glm-4.5-air",
  "sessionId": "8f3e...",
  "toolsCount": 0,
  "inputTokens": 48874,
  "cacheRead": 48640,
  "cacheCreate": 0,
  "hitPct": 99.5,
  "provider": "novita",
  "strategy": "priority",
  "region": null,
  "attempt": 1,
  "fallback": false,
  "generationId": "gen-..."
}
```

`provider`, `strategy`, `region`, `attempt`, `fallback`, and `generationId` are populated only when routing metadata is present (i.e., `routerMetadata` is on and the upstream returns it).

## normalizeVolatileSystem (stable prefix for non-Anthropic providers)

Claude Code embeds volatile `cch=…` (per-turn) and `cc_version=<semver>.<hash>` (per-build) hashes in the system prompt that change on (almost) every turn. For **Anthropic-native** providers this is harmless — the cache key absorbs it. But for **non-Anthropic** providers (qwen, glm, and others routed through OpenRouter), those churned bytes sit inside the cached prefix, so the prefix cache never warms and every turn re-pays full price.

`normalizeVolatileSystem` rewrites those volatile hashes out of `messages[0]` (the system block) so the prefix bytes stay stable turn-to-turn. The readable `cc_version` semver is preserved; only the drifting build hash is collapsed.

```yaml
normalizeVolatileSystem: true   # strip the volatile cch/cc_version hashes from the system prompt
```

- **Enable when:** you route Claude Code through a non-Anthropic provider and the cache-read log stays near zero.
- **No effect on:** Anthropic-native caching (the hash is harmless there) — safe to leave on globally.
- **Per-model:** unset inherits the global value.

```yaml
modelOverrides:
  "qwen-*":
    provider:
      only: "qwen"          # non-Anthropic provider
    normalizeVolatileSystem: true
```

Toggle it from the menu (`proxitor config` → **💾 Caching** → Stabilize prefix) or `proxitor config cache`.

## Interactive Config Manager

### Setup wizard

```sh
proxitor config wizard
```

The wizard asks for:

- **OpenRouter API key** — stored in config or set as `OPENROUTER_API_KEY` env var
- **Port** — default `8828` (avoids conflicts with common dev servers on 8080)
- **Listen address** — all interfaces (`0.0.0.0`), localhost only (`127.0.0.1`), or a custom address (IP, hostname, or `unix:/path`)
- **API base URL** — default `https://openrouter.ai/api`; change for self-hosted or custom endpoints
- **Authentication type** — `bearer` (default) or `oauth`; use `oauth` for custom proxy providers that pass tokens in the `Authorization: OAuth ...` header
- **Save location** — project directory, `~/.config/proxitor/`, or `$XDG_CONFIG_HOME/proxitor/`

After collecting the key, base URL, and auth type, the wizard performs a **best-effort upstream probe** (3 s timeout) to verify connectivity. If the upstream is unreachable or the key is rejected, a warning is shown but the config is still saved — this is informational only.

If a config already exists, the wizard shows its location and asks whether to reconfigure. All fields are **pre-filled** with current values — press Enter to keep, or type a new value. Existing `modelOverrides`, `provider`, and other fields are preserved — only the wizard fields are updated.

### Config menu and commands

`proxitor config` (or `proxitor config menu`) opens an interactive menu that loops until you exit. From there you can manage all settings:

- **Show current config** — display the resolved configuration
- **API key & connection** — change API key, port, listen address, base URL, auth type
- **Caching** — the three caching levers on one screen: `cacheControl` (+TTL), `sessionId`, `normalizeVolatileSystem`
- **Model overrides** — add, edit, remove, list, or browse models (each override has its own **💾 Caching** submenu)

```sh
proxitor config menu           # interactive menu
proxitor config add            # add a model override
proxitor config edit           # edit existing override
proxitor config remove         # remove override(s)
proxitor config list           # show current overrides
proxitor config list --json    # overrides as JSON
proxitor config show           # print the resolved config (merged)
proxitor config show --json    # same, machine-readable
proxitor config browse         # explore models with pricing info
proxitor config wizard         # interactive setup wizard
proxitor config validate       # validate config file (exit 0 ok, 1 invalid)
proxitor config validate --json  # structured JSON result
proxitor doctor                # diagnose environment + network + port + version
proxitor doctor --json         # machine-readable diagnostic report
proxitor doctor --offline      # skip network checks
```

When adding or editing a model override, you can also configure per-model `sessionId` and `cacheControl` — useful for models that need different caching or routing behavior than the global default.

In `config edit`, any field (provider, session ID, cache control, cache TTL) can be reset to inherit the global/default value via the **Reset / inherit** prompt option. The global `config cache-control` and `config session-routing` commands support the same reset — it reverts the field to the schema default.

### Add override walkthrough

```sh
$ proxitor config add

┌──────────────────────────────────┐
│   Add Model Override             │
╰──────────────────────────────────╯

◇ Search for a model
│ claude
  (23 matches)
  ● anthropic/claude-sonnet-4-6 · $3.00/$15.00 · 200k
  ○ anthropic/claude-opus-4-8   · $15.00/$75.00 · 200k
  ...

◇ Configure provider routing
│ ○ Use specific providers only
  ○ Set provider priority order
  ○ Ignore specific providers
  ○ Skip provider routing
```

**"Use specific providers only" / "Ignore specific providers"** — multiselect, pick all that apply:

```text
◇ Select providers
  ◼ anthropic (anthropic)     · 1.0s · 40 t/s
  ◻ google-vertex/global      · 1.1s · 39 t/s
  ◻ amazon-bedrock            · 1.2s · 40 t/s
```

**"Set provider priority order"** — pick providers one at a time, then select **✓ Done** at the bottom to finish:

```text
◇ Select provider #1 (or cancel to finish)
│ ● anthropic (anthropic)     · 1.0s · 40 t/s
  ○ google-vertex/global      · 1.1s · 39 t/s
  ○ amazon-bedrock            · 1.2s · 40 t/s
  ○ ✓ Done

◇ Select provider #2 (or cancel to finish)
│ ● google-vertex/global      · 1.1s · 39 t/s
  ○ amazon-bedrock            · 1.2s · 40 t/s
  ○ ✓ Done

◇ Select provider #3 (or cancel to finish)
│ ● ✓ Done

◇ Allow fallbacks to other providers? Yes

◇ Save to config? Yes

╭──────────────────────────────────╮
│ ✓ Model override saved           │
╰──────────────────────────────────╯
```

The interface uses live data from the OpenRouter API — model search with type-ahead, real provider availability and pricing for each model.

## Diagnostics

When something doesn't work, `proxitor doctor` runs a battery of checks and prints a report. Sections cover:

- **Environment** — Node version, platform, TTY
- **Config** — discovery path, validity, override count
- **API key** — resolution (env vs. file; never prints the key)
- **Network** — upstream reachability (with configurable timeout)
- **Port** — availability of the configured port
- **Version** — installed version

Statuses: `✓ ok` / `⚠ warn` / `✗ fail` / `ⓘ skip`. Exit code is `0` when no `fail`, `1` otherwise — scriptable from CI.

```sh
$ proxitor doctor

▲ Proxitor Doctor
│
◇ Environment
│  ✓ node-version — v22.4.1
│  ✓ platform — darwin arm64
│  ✓ tty — true
│
◇ Config
│  ✓ config-found — /Users/u/proj/proxitor.config.yaml
│  ✓ config-valid — 12 keys, 3 override(s)
│
◇ API key
│  ✓ api-key — set (env: set, file: set)
│
◇ Network
│  ✓ upstream — https://openrouter.ai/api — 200, 342 models
│
◇ Port
│  ✓ port-8828 — 127.0.0.1:8828
│
◇ Version
│  ✓ version — 0.9.0-beta.5

└ Done. All checks passed.
```

Useful flags:

```sh
proxitor doctor --json         # structured JSON for CI / scripts
proxitor doctor --offline      # skip network checks (no upstream, no npm)
proxitor doctor --timeout 5000 # custom per-check network timeout (ms)
```

## CLI options

```sh
proxitor                        # start the proxy (default command)
proxitor start                  # same as above
proxitor up                     # alias for start
proxitor run                    # alias for start
proxitor --port 9000            # override port
proxitor --config ./team.yaml   # use an explicit config
proxitor config show            # print the resolved config
proxitor config show --json     # machine-readable config
proxitor config list --json     # overrides as JSON
proxitor config wizard          # interactive setup
proxitor config validate        # check the current config (exit 0/1)
proxitor config validate --json # structured JSON result
proxitor doctor                 # diagnose environment, network, port, version
proxitor doctor --offline       # skip network checks
proxitor --help                 # full help
proxitor --version              # print version
```

| Flag | Default | Description |
|---|---|---|
| `-p, --port <port>` | `8828` | Server port (validated: 1-65535) |
| `--host <host>` | `0.0.0.0` | Server host |
| `-c, --config <path>` | auto-discovered | Path to config file |
| `--openrouter-key <key>` / `-k <key>` | `$OPENROUTER_API_KEY` | OpenRouter API key |
| `--verbose` | `false` | Enable verbose logging |
| `--no-config` | | Skip config file discovery |
| `-v, --version` | | Print version |
| `--help` | | Print help |

Subcommands live under `proxitor config <subcommand>`. Run `proxitor config --help` for the full list.

---

← [Back to README](../README.md)
