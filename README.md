# proxitor

<p align="center">
  <strong>A transparent proxy between your AI CLI tools and OpenRouter.</strong><br/>
  Route by provider. Control costs. Keep streaming. Zero config changes in Claude Code.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="https://github.com/neiromaster/proxitor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <img src="https://img.shields.io/badge/built_with-TypeScript-3178c6?labelColor=1e2327" alt="TypeScript">
</p>

---

```
  Claude Code / Codex
        │
        │  ANTHROPIC_BASE_URL=http://localhost:8828/v1
        ▼
  ┌───────────────┐
  │   proxitor    │  ← injects provider routing
  │  :8828        │  ← streams SSE back unchanged
  └───────────────┘
        │
        │  + X-OpenRouter-* headers
        ▼
     OpenRouter
   ┌──────┬──────┐
  Anthropic  DeepInfra  Azure  ...
```

---

## Why

### The prompt cache problem

OpenRouter is convenient — one key, every model. But by default it load-balances across multiple provider instances for the same model. Each request can land on a different provider, and **prompt caching is provider-scoped**: a cache entry built on Anthropic's infrastructure doesn't help when the next request goes to DeepInfra.

Claude Code sends a large system prompt on every single request. Without a pinned provider, you pay full token price every time. With proxitor locking `claude-*` to `anthropic`, that system prompt gets cached after the first hit and subsequent requests cost a fraction.

```yaml
# pin all Claude models to Anthropic — prompt cache works reliably
modelOverrides:
  "claude-*":
    provider:
      only: "anthropic"
```

### Other reasons to use it

- **Cost control** — route specific models to cheaper providers when caching isn't the priority
- **Automatic fallbacks** — if Anthropic is degraded, fall back to DeepInfra without touching your tools
- **Mixed routing** — `claude-*` on Anthropic, `gpt-*` on Azure, different rules per model
- **Data privacy** — enforce `dataCollection: deny` or ZDR across all requests

Proxitor sits between your CLI tools and OpenRouter, injecting all of this transparently. Your tools don't know anything changed.

---

## Install

```sh
# npm
npm install -g proxitor

# bun
bun install -g proxitor

# no install needed
npx proxitor
```

---

## Quick Start

**1. Start the proxy**

```sh
OPENROUTER_API_KEY=sk-or-... proxitor
# Listening on http://0.0.0.0:8828
```

**2. Point your tools at it**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:8828/v1 claude

# Codex
OPENAI_BASE_URL=http://localhost:8828/v1 codex
```

That's it. Requests flow through proxitor to OpenRouter, SSE streams pass through unchanged.

---

## Configuration

Proxitor looks for a config file in this order:

```
proxitor.config.yaml  →  proxitor.config.yml  →  proxitor.config.json
.proxitor.yaml        →  .proxitor.yml         →  .proxitor.json
```

**Priority:** CLI flags > config file > environment variables > defaults

All defaults are derived from a single Zod schema (`DEFAULTS`) — no hardcoded constants scattered across modules. Config values are validated through Zod on load, including the final merged result.

See [`proxitor.config.example.yaml`](./proxitor.config.example.yaml) for the complete reference.

### Provider routing

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

### Per-model overrides

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

**Match priority:** exact name > longer prefix > shorter prefix.

### Custom headers

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

### Health check

```sh
curl http://localhost:8828/health
```

---

## Interactive Config Manager

Proxitor includes an interactive CLI for managing model overrides — search models, pick providers, and write to config without editing YAML by hand.

### Setup wizard

Run the wizard to create or update your config interactively. If no config exists, any command will offer to launch it automatically.

```sh
proxitor config wizard
```

The wizard asks for:

- **OpenRouter API key** — stored in config or set as `OPENROUTER_API_KEY` env var
- **Port** — default `8828` (avoids conflicts with common dev servers on 8080)
- **API base URL** — default `https://openrouter.ai/api/v1`; change for self-hosted or custom endpoints
- **Host** — all interfaces (`0.0.0.0`) or localhost only (`127.0.0.1`)
- **Save location** — project directory, `~/.config/proxitor/`, or `$XDG_CONFIG_HOME/proxitor/`

If a config already exists, the wizard shows its location and asks whether to reconfigure. Existing `modelOverrides`, `provider`, and other fields are preserved — only the wizard fields are updated.

```sh
proxitor config menu           # interactive menu
proxitor config add            # add a model override
proxitor config edit           # edit existing override
proxitor config remove         # remove override(s)
proxitor config list           # show current overrides
proxitor config browse         # explore models with pricing info
proxitor config wizard         # interactive setup wizard
proxitor config validate       # validate config file
```

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

---

## CLI Options

| Flag | Default | Description |
|---|---|---|
| `-p, --port <port>` | `8828` | Server port |
| `-h, --host <host>` | `0.0.0.0` | Server host |
| `-c, --config <path>` | auto-discovered | Path to config file |
| `--openrouter-key <key>` | `$OPENROUTER_API_KEY` | OpenRouter API key |
| `--verbose` | `false` | Enable verbose logging |
| `-v, --version` | | Print version |
| `--help` | | Print help |

---

## Development

```sh
pnpm install          # install dependencies
pnpm dev              # build + watch
pnpm test             # run tests
pnpm test:e2e         # end-to-end tests
pnpm typecheck        # TypeScript check
pnpm check:biome      # lint + format check
pnpm lint:fix         # auto-fix lint issues
pnpm build            # production build
pnpm check            # typecheck + biome + test (full CI)
```

---

## License

[MIT](./LICENSE)
