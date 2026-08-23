# Configuration reference

🌍 **English** · [Русский](./configuration.ru.md)

Full reference for configuring proxitor v1 by hand. Every field is derived from [`packages/proxy-core/src/application/config-schema.ts`](../packages/proxy-core/src/application/config-schema.ts).

A complete example lives at [`proxitor.config.example.yaml`](../proxitor.config.example.yaml).

## Config file location

Proxitor looks for a config file in this order:

```
1. --config <path>                              # CLI flag (explicit path)
2. ~/proxitor.config.{yaml,yml,json}           # HOME shadows XDG
3. ~/.proxitor.{yaml,yml,json}
4. $XDG_CONFIG_HOME/proxitor/config.{yaml,yml,json}   # default ~/.config/proxitor/…
```

Default `XDG_CONFIG_HOME` is `~/.config` on Linux/macOS.

**Priority:** CLI flags > config file > environment variables > schema defaults.

> **HOME shadows XDG:** If a config exists at `~/proxitor.config.yaml` or `~/.proxitor.yaml`, it **shadows** the XDG location. The wizard warns you about this. Only one config file is loaded; the first found in the search order wins.

## Config schema overview

```yaml
version: 1                    # required, literal integer

providers:                    # required, at least one
  <provider-id>:             # YAML key becomes the provider id
    baseUrl: <string>
    wireFormat: <anthropic-messages | openai-chat>
    auth:
      type: <bearer | x-api-key | header | none>
      credential: <string | {env: <VAR>} | {file: <path>}>
      headerName: <string>   # required when type=header
    headers:                 # optional, extra provider headers
      <name>: <value>
    plugins:                 # optional, provider-level plugin list
    unsupportedParams: <error | drop>
    maxTokensField: <auto | max_tokens | max_completion_tokens>

models:                       # required, at least one binding
  - match: <glob>
    provider: <provider-id>
    modelId: <string | $MODEL>
    plugins:                 # optional, model-level plugin list

defaultProvider: <provider-id>   # optional, serves model-less requests

plugins:                      # optional, global plugin list

server:                       # optional, defaults shown
  host: 127.0.0.1
  port: 8828
  bodyLimit: 50mb
  forwardHeaders: []         # optional, header names to forward from inbound

controlPlane:                 # optional
  token: <string | {env: <VAR>} | {file: <path}>

observability:                # optional, defaults shown
  routerMetadata: true
  hitThreshold: 80
  sideMaxTokens: 4096
  sessionMaxEntries: 4096
  sessionTtlMs: 600000

logging:                      # optional
  verbose: false
```

## Top‑level fields

### `version`

**Required.** Literal `1` — the config schema version.

```yaml
version: 1
```

Source: [`config-schema.ts:159`](../packages/proxy-core/src/application/config-schema.ts#L159)

### `providers`

**Required.** Map of provider configurations. The YAML key **becomes** the provider id (referenced by `models[].provider` and `defaultProvider`).

Must declare at least one provider.

**Provider fields:**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `baseUrl` | string (min 1) | — | Provider base URL (e.g. `https://api.openai.com`) |
| `wireFormat` | enum | — | `anthropic-messages` or `openai-chat` |
| `auth.type` | enum | — | `bearer`, `x-api-key`, `header`, `none` |
| `auth.credential` | string or `{env: VAR}` or `{file: path}` | — | API key or credential reference |
| `auth.headerName` | string (min 1) | — | Header name (required when `type: header`) |
| `headers` | `{[key: string]: string}` | — | Extra headers for this provider (optional) |
| `plugins` | plugin list | — | Provider‑level plugins (optional) |
| `unsupportedParams` | `error` \| `drop` | — | How to handle unsupported request parameters (optional) |
| `maxTokensField` | `auto` \| `max_tokens` \| `max_completion_tokens` | — | Which field to use for max tokens (optional) |

**Example:**

```yaml
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth: { type: bearer, credential: { env: OPENAI_API_KEY } }
  anthropic:
    baseUrl: https://api.anthropic.com
    wireFormat: anthropic-messages
    auth: { type: x-api-key, credential: { env: ANTHROPIC_API_KEY } }
    headers: { anthropic-version: '2023-06-01' }
```

**Credential resolution:**

- `credential: "sk-..."` — literal string (use only for testing; **not recommended** for production)
- `credential: { env: "VAR_NAME" }` — read from environment variable (`process.env.VAR_NAME`)
- `credential: { file: "/path/to/file" }` — read from file (runtime load; hot‑reload restarts if file changes)

**Warning:** Changing an `env:`‑based credential requires a proxitor restart — the watcher only reloads on config file writes, not env var changes.

Source: [`config-schema.ts:18-56`](../packages/proxy-core/src/application/config-schema.ts#L18-L56)

### `models`

**Required.** Array of model bindings. Must declare at least one binding.

**Binding fields:**

| Field | Type | Description |
| --- | --- | --- |
| `match` | string (min 1) | Glob pattern to match logical model names (e.g. `claude-*`, `*`) |
| `provider` | string (min 1) | Provider id (must exist in `providers`) |
| `modelId` | string (min 1) | Outbound model identifier; `$MODEL` passes the logical name through unchanged |
| `plugins` | plugin list | Model‑level plugins (optional) |

**First match wins.** Patterns are globs; `*` matches any sequence. Use `$MODEL` to pass the client‑sent model name through unchanged (common when the provider uses the same names).

**Example:**

```yaml
models:
  - match: 'claude-*'          # glob prefix
    provider: glm
    modelId: 'claude-${MODEL}'   # substitute logical name
  - match: '*'                # catch‑all
    provider: openai
    modelId: '$MODEL'        # pass through unchanged
```

When a client requests `claude-sonnet-4-6`:
1. `claude-*` matches → `provider: glm`, `modelId` becomes `claude-claude-sonnet-4-6`
2. That provider/model is used for the request

Source: [`config-schema.ts:58-67`](../packages/proxy-core/src/application/config-schema.ts#L58-L67)

### `defaultProvider`

**Optional.** Provider id (must exist in `providers`). Serves model‑less requests:

- Embeddings API calls (no model in payload)
- `/v1/models` listing

If omitted, model‑less requests fail with `404`.

**Example:**

```yaml
defaultProvider: openai
```

Source: [`config-schema.ts:163`](../packages/proxy-core/src/application/config-schema.ts#L163)

### `plugins`

**Optional.** Global plugin list. Plugins run in declaration order on every request.

Each entry is either:

- A string (plugin name, e.g. `cache-control`)
- An object `{name: <plugin>, options: {...}}` for plugin options

**Example:**

```yaml
plugins:
  - normalize-volatile-system
  - cache-control:
      cacheControl: auto
      ttl: 1h
      rewriteBlockTtl: auto
  - session-id
```

**Plugin layers (merge order):** global → provider → model. Inner layers can disable outer‑layer plugins via the `disable` list (see below).

**Built‑in plugins:**

| Plugin name | Options |
| --- | --- |
| `normalize-volatile-system` | — (no options) |
| `cache-control` | `cacheControl` (auto/always/skip), `ttl` (5m/1h/omit), `rewriteBlockTtl` (auto/skip) |
| `session-id` | `mode` (auto/skip) |
| `openrouter-routing` | [OpenRouter routing options](#openrouter-routing) |

Source: [`config-schema.ts:24-26`](../packages/proxy-core/src/application/config-schema.ts#L24-L26)

### `server`

**Optional.** Server configuration.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | string (min 1) | `127.0.0.1` | Listen address |
| `port` | number (1‑65535) | `8828` | Listen port |
| `bodyLimit` | string or number | `50mb` | Max request body size (e.g. `10mb`, `50mb`, `1gb`) |
| `forwardHeaders` | `string[]` | `[]` | Header names to forward from inbound request to provider |

**`bodyLimit` formats:** `"50mb"` (string) or `52428800` (bytes number). Units: `b`, `kb`, `mb`, `gb` (case‑insensitive).

**Example:**

```yaml
server:
  host: 0.0.0.0        # all interfaces
  port: 9000
  bodyLimit: 100mb
  forwardHeaders:
    - x-custom-api-key
    - x-request-id
```

Source: [`config-schema.ts:110-125`](../packages/proxy-core/src/application/config-schema.ts#L110-L125)

### `controlPlane`

**Optional.** Control plane authentication.

| Field | Type | Description |
| --- | --- | --- |
| `token` | string or `{env: VAR}` or `{file: path}` | Token required for `/control/*` endpoints |

If omitted, `/control/*` endpoints return `404` (indistinguishable from a missing route).

**Example:**

```yaml
controlPlane:
  token: { env: PROXITOR_CONTROL_TOKEN }
```

Usage:

```bash
# Export the token
export PROXITOR_CONTROL_TOKEN=secret-token

# Hit the control plane
curl -H "Authorization: Bearer secret-token" http://127.0.0.1:8828/control/routing
```

Source: [`config-schema.ts:146-149`](../packages/proxy-core/src/application/config-schema.ts#L146-L149)

### `observability`

**Optional.** Observability and cache tracking.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `routerMetadata` | boolean | `true` | Send `x-openrouter-metadata` header to capture provider routing (where available) |
| `hitThreshold` | number (0‑100) | `80` | Cache read / input tokens % ≥ this → `HIT` (otherwise `PARTIAL`) |
| `sideMaxTokens` | number (positive) | `4096` | Request with no tools AND `max_tokens` ≤ this → `[side]` classification |
| `sessionMaxEntries` | number (positive) | `4096` | Bounded LRU capacity for session tracker (FIFO eviction) |
| `sessionTtlMs` | number (positive) | `600000` | Session tracker entry TTL (10 minutes) |

**Cache outcome labels:**

| Label | Meaning |
| --- | --- |
| `HIT` | Cache read ≥ `hitThreshold`% of input tokens |
| `PARTIAL` | Some cache read, but below threshold |
| `MISS` | No cache read on a **repeat** request in the same session |
| `COLD` | No cache read on the **first** request in a session |
| `NOUSAGE` | No usage object observed (malformed response, etc.) |

**Request type:** Each request logs as `[main]` or `[side]`. `[side]` = no tools AND `max_tokens ≤ sideMaxTokens`.

**Example:**

```yaml
observability:
  routerMetadata: true
  hitThreshold: 80
  sideMaxTokens: 4096
  sessionMaxEntries: 4096
  sessionTtlMs: 600000
```

**Console output (per request):**

```
[a1b2] HIT   99%  read 48640  in 48874  glm-4.5-air  [main]
[c3d4] PARTIAL  42%  read 1088  in 2600  provider=anthropic  claude-sonnet-4-6  [side]
```

**Body dumps:** Set `PROXITOR_DUMP_BODY=1` to write paired request/response dumps to `~/.cache/proxitor/dumps`. Each dump is enriched with `label`, `hitPct`, `provider`, etc.

Source: [`config-schema.ts:127-144`](../packages/proxy-core/src/application/config-schema.ts#L127-L144)

### `logging`

**Optional.** Logging configuration.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `verbose` | boolean | `false` | Enable verbose logging |

**Example:**

```yaml
logging:
  verbose: true
```

Source: [`config-schema.ts:151-156`](../packages/proxy-core/src/application/config-schema.ts#L151-L156)

## Plugin layers and disable semantics

Plugins run in three layers:

1. **Global** (`plugins` top‑level) — runs on every request
2. **Provider** (`providers.<id>.plugins`) — runs only for that provider
3. **Model** (`models[].plugins`) — runs only for that model

**Merge order:** global → provider → model (inner layers augment outer ones).

**Disable:** Any layer can disable specific plugins from outer layers:

```yaml
plugins:
  - cache-control
  - session-id

providers:
  openai:
    plugins:
      - disable: [cache-control]   # disable global cache-control for OpenAI

models:
  - match: 'claude-*'
    provider: anthropic
    modelId: '$MODEL'
    plugins:
      - disable: [session-id]      # disable global session-id for Claude models
```

Use this to opt‑out of globals for specific routes.

## Built‑in plugins

### `normalize-volatile-system`

Strips Claude Code's volatile hashes from system prompts:

- `cch=<hex>` (per‑turn hash) → constant `cch=00000`
- `cc_version=<semver>.<hex>` → `cc_version=<semver>.0`

These hashes drift every turn and break prefix caching for non‑Anthropic providers (GLM, Qwen, etc.). Normalizing them stabilizes the cached prefix.

**No options.**

```yaml
plugins:
  - normalize-volatile-system
```

Source: [`plugins/built-in/normalize-volatile-system.ts`](../packages/proxy-core/src/plugins/built-in/normalize-volatile-system.ts)

### `cache-control`

Injects and rewrites `cache_control` breakpoints with TTL normalization.

**Options:**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `cacheControl` | `auto` \| `always` \| `skip` | `auto` | Injection mode |
| `ttl` | `5m` \| `1h` \| `omit` | — | Cache TTL (optional) |
| `rewriteBlockTtl` | `auto` \| `skip` | `auto` | Normalize block‑level TTL to match `ttl` |

**`cacheControl` modes:**

| Mode | Behavior |
| --- | --- |
| `auto` | Inject only when request already has cache breakpoints (Anthropic‑native safe default) |
| `always` | Always inject cache breakpoints |
| `skip` | Passthrough — do not inject |

**`ttl` values:**

| Value | TTL | Use when |
| --- | --- | --- |
| `5m` | 5 minutes (Anthropic default) | High‑frequency requests (>1 per 5 min) |
| `1h` | 1 hour | Low‑frequency or long‑running sessions |
| `omit` | Strip the `ttl` field | Force‑disable TTL |

**`rewriteBlockTtl` modes:**

| Mode | Behavior |
| --- | --- |
| `auto` | Rewrite existing block TTLs to `ttl` on Anthropic‑native endpoints |
| `skip` | Leave block TTLs untouched |

**Why `rewriteBlockTtl`?** Claude Code sends block‑level `cache_control` without a `ttl` (Anthropic treats them as `5m`). If you set `ttl: 1h`, the request leaves with mixed `1h` root / `5m` blocks → Anthropic rejects it. `rewriteBlockTtl: auto` normalizes blocks to `1h`.

**Example:**

```yaml
plugins:
  - cache-control:
      cacheControl: auto
      ttl: 1h
      rewriteBlockTtl: auto
```

Source: [`plugins/built-in/cache-control.ts`](../packages/proxy-core/src/plugins/built-in/cache-control.ts)

### `session-id`

Sticky routing via `x-session-id` header. Derives a stable session ID from the logical model, system prompt, and first user message.

**Options:**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `auto` \| `skip` | `auto` | Session ID mode |

**`mode` values:**

| Mode | Behavior |
| --- | --- |
| `auto` | Generate session ID if client didn't send one |
| `skip` | Passthrough — do not generate |

**Example:**

```yaml
plugins:
  - session-id:
      mode: auto
```

Source: [`plugins/built-in/session-id.ts`](../packages/proxy-core/src/plugins/built-in/session-id.ts)

### `openrouter-routing`

Provider routing hints for OpenRouter's `openai-chat` format. Writes `extensions['openai-chat']['$proxitor.provider']` with routing options; the encoder maps it onto the wire body.

**Options (all optional):**

| Option | Type | Description |
| --- | --- | --- |
| `only` | string or `string[]` | Allow only these providers |
| `order` | string or `string[]` | Try providers in this priority order |
| `ignore` | string or `string[]` | Never use these providers |
| `allowFallbacks` | boolean | Allow fallbacks outside `order` (default `true` when `order` is set) |
| `sort` | `"price"` \| `"throughput"` \| `"latency"` \| `{by, partition?}` | Sort providers by metric |
| `quantizations` | `string[]` | Filter by quantization level (e.g. `["fp8"]`) |
| `maxPrice` | `{prompt?, completion?, request?, image?}` | Maximum pricing ($/M tokens) |
| `requireParameters` | boolean | Only use providers that support all request parameters |
| `dataCollection` | `"allow"` \| `"deny"` | Data collection policy |
| `zdr` | boolean | Zero Data Retention enforcement |
| `enforceDistillableText` | boolean | Enforce distillable‑text flag |
| `preferredMinThroughput` | number or `{p50?, p75?, p90?, p99?}` | Soft minimum throughput threshold |
| `preferredMaxLatency` | number or `{p50?, p75?, p90?, p99?}` | Soft maximum latency threshold |

**Example:**

```yaml
plugins:
  - openrouter-routing:
      only: anthropic
      maxPrice: { prompt: 1, completion: 2 }
      dataCollection: deny
```

**Note:** This plugin is gated to `openai-chat` routes via reserved keys; it does not affect `anthropic-messages` requests.

Source: [`plugins/built-in/openrouter-routing.ts`](../packages/proxy-core/src/plugins/built-in/openrouter-routing.ts)

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PROXITOR_DUMP_BODY=1` | Write request/response dumps to `~/.cache/proxitor/dumps` |
| `PROXITOR_CONTROL_TOKEN` | Control plane token (when `controlPlane.token` uses `{env: PROXITOR_CONTROL_TOKEN}`) |
| `PROXITOR_DUMP_DIR` | Override dump directory (default `~/.cache/proxitor/dumps`) |
| `XDG_CONFIG_HOME` | Override user config directory (default `~/.config`) |

**Credential env vars** (referenced in `auth.credential.{env: ...}`): Use whatever variable name you choose (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). Proxitor reads them at startup; changes require a restart.

## Complete annotated example

```yaml
# proxitor v1 configuration — copy to ~/.config/proxitor/config.yaml
# or pass --config <path>.

version: 1

# Global plugins (run on every request)
plugins:
  - normalize-volatile-system
  - cache-control:
      cacheControl: auto
      ttl: 1h
      rewriteBlockTtl: auto
  - session-id

# Provider configurations (YAML key = provider id)
providers:
  openai:
    baseUrl: https://api.openai.com
    wireFormat: openai-chat
    auth:
      type: bearer
      credential: { env: OPENAI_API_KEY }   # reads from process.env.OPENAI_API_KEY
    # Optional: extra headers for this provider
    # headers:
    #   x-custom: value

  anthropic:
    baseUrl: https://api.anthropic.com
    wireFormat: anthropic-messages
    auth:
      type: x-api-key
      credential: { env: ANTHROPIC_API_KEY }
    headers: { anthropic-version: '2023-06-01' }

  glm:
    baseUrl: https://api.example.com
    wireFormat: openai-chat
    auth:
      type: bearer
      credential: { env: GLM_API_KEY }
    # Provider-level plugins (augment global, can disable globals)
    plugins:
      - disable: [cache-control]   # disable cache-control for GLM

# Model routing table (first match wins)
models:
  # Glob prefix — all claude-* models go to GLM
  - match: 'claude-*'
    provider: glm
    modelId: '$MODEL'           # pass logical name through unchanged
    plugins:
      - disable: [session-id]  # disable session-id for Claude models

  # Catch-all — everything else to OpenAI
  - match: '*'
    provider: openai
    modelId: '$MODEL'

# Default provider for model-less requests (embeddings, /v1/models)
defaultProvider: openai

# Server configuration
server:
  host: 127.0.0.1
  port: 8828
  bodyLimit: 50mb
  # Optional: forward specific inbound headers to providers
  # forwardHeaders:
  #   - x-custom-api-key

# Control plane (required for /control/* endpoints)
controlPlane:
  token: { env: PROXITOR_CONTROL_TOKEN }

# Observability (cache tracking, request classification)
observability:
  routerMetadata: true          # capture provider routing metadata
  hitThreshold: 80             # cache read ≥ 80% → HIT
  sideMaxTokens: 4096          # small requests → [side]
  sessionMaxEntries: 4096      # session tracker capacity
  sessionTtlMs: 600000         # session tracker TTL (10 minutes)

# Logging
logging:
  verbose: false
```

← [Back to README](../README.md)
