# proxitor

<p align="center">
  <strong>Multi-provider LLM gateway with a plugin pipeline.</strong><br/>
  Anthropic Messages and OpenAI Chat in — any provider out.<br/>
  One YAML file, hot‑reloaded.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="https://github.com/neiromaster/proxitor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/neiromaster/proxitor/ci.yml?branch=main&color=22c55e&labelColor=1e2327&label=CI" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <a href="https://github.com/neiromaster/proxitor/issues"><img src="https://img.shields.io/github/issues/neiromaster/proxitor?color=f59e0b&labelColor=1e2327&label=issues" alt="GitHub issues"></a>
</p>

🌍 **English** · [Русский](./docs/README.ru.md)

---

## Why proxitor

- **Point Claude Code (or any Anthropic/OpenAI client) at one local endpoint** — route each model to any provider
- **Wire‑format translation via Canonical IR** — `anthropic‑messages` ⇄ `openai‑chat`, streaming end‑to‑end
- **Plugin pipeline on every request/response** — built‑ins: `normalize‑volatile‑system`, `cache‑control`, `session‑id`, `openrouter‑routing`; write your own against `@proxitor/plugin-api`
- **Prompt‑cache observability** — `HIT`/`PARTIAL`/`MISS`/`COLD` per request, session tracking, body dumps
- **Hot‑reload with keep‑last‑valid** — bad edits fall back to the last good config; token‑gated control plane; graceful drain shutdown

## How it works

```text
Claude Code client
       │
       ▼
┌─────────────────────────────────────────────┐
│  proxitor (Hono server)                    │
│  ┌─────────────────────────────────────┐   │
│  │ 1. Decode inbound (anthropic-messages│   │
│  │    or openai-chat) → Canonical IR   │   │
│  │                                     │   │
│  │ 2. Plugin pipeline (3 layers)       │   │
│  │    global → provider → model        │   │
│  │                                     │   │
│  │ 3. Route model table (glob match,   │   │
│  │    $MODEL passthrough)              │   │
│  │                                     │   │
│  │ 4. Encode outbound (provider format)│   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Observability tap (cache lines, dumps)    │
│  Hot-reload watcher (config write)          │
│  Control plane (/control/* with token)      │
└─────────────────────────────────────────────┘
       │
       ▼
  provider (OpenAI / Anthropic / GLM / …)
```

Request and streaming responses pass through the same pipeline in reverse.

## Install

Requires **Node.js 22+**.

```sh
npm install -g proxitor
# or:  pnpm install -g proxitor
# or:  npx proxitor@latest
```

## Quick start

**1. Generate a minimal config**

```sh
proxitor config wizard
```

**2. Start the gateway**

```sh
proxitor start
# → proxitor listening on http://127.0.0.1:8828
```

**3. Point your client at it**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://127.0.0.1:8828 ANTHROPIC_API_KEY=sk-… claude

# Codex (OpenAI-compatible)
OPENAI_BASE_URL=http://127.0.0.1:8828 OPENAI_API_KEY=sk-… codex
```

**4. Validate setup**

```sh
proxitor doctor
```

## Commands

| Command | Description |
| --- | --- |
| `proxitor start` | Start the gateway |
| `proxitor config wizard` | Interactive config generator |
| `proxitor doctor` | Diagnose environment and configuration |

**`proxitor start`** flags:

| Flag | Default | Description |
| --- | --- | --- |
| `--config <path>` | XDG search | Config file path |
| `--host <host>` | config `server.host` | Listen host |
| `--port <port>` | config `server.port` | Listen port |
| `--verbose` | `false` | Verbose logging |

**`proxitor doctor`** flags:

| Flag | Description |
| --- | --- |
| `--config <path>` | Config file path (default: XDG search) |
| `--json` | Machine-readable JSON output |

## Configuration

Minimal example (full reference in [`docs/configuration.md`](./docs/configuration.md)):

```yaml
version: 1

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

models:
  - match: 'claude-*'
    provider: anthropic
    modelId: '$MODEL'
  - match: '*'
    provider: openai
    modelId: '$MODEL'

defaultProvider: openai

server:
  host: 127.0.0.1
  port: 8828
```

Config discovery order:

```
1. --config <path>                    # CLI flag
2. ~/proxitor.config.{yaml,yml,json}   # HOME shadows XDG
3. ~/.proxitor.{yaml,yml,json}
4. $XDG_CONFIG_HOME/proxitor/config.{yaml,yml,json}  # default ~/.config/proxitor/…
```

> **Warning:** A config in `~/` shadows `$XDG_CONFIG_HOME`. The wizard warns about this.

## Plugin pipeline

Three plugin layers (global → provider → model). Plugins run in declaration order; each layer can disable entries from outer layers.

**Built‑in plugins:**

| Plugin | What it does | Options |
| --- | --- | --- |
| `normalize-volatile-system` | Strip Claude Code's `cch=` and `cc_version=` hashes from system prompts (stabilizes prefix cache on non‑Anthropic providers) | — |
| `cache-control` | Inject/rewrite `cache_control` breakpoints with TTL normalization | `cacheControl` (auto/always/skip), `ttl` (5m/1h/omit), `rewriteBlockTtl` (auto/skip) |
| `session-id` | Sticky routing via `x-session-id` header | `mode` (auto/skip) |
| `openrouter-routing` | Provider routing hints for `openai-chat` → OpenRouter (writes `extensions['openai-chat']['$proxitor.provider']`) | [OpenRouter routing options](./docs/configuration.md#openrouter-routing-plugin) |

Write custom plugins against [`@proxitor/plugin-api`](https://www.npmjs.com/package/@proxitor/plugin-api).

**Model routing:** Glob patterns (`*`), `$MODEL` passthrough, first‑match‑wins. Example:

```yaml
models:
  - match: 'claude-*'      # glob prefix
    provider: glm
    modelId: 'claude-${MODEL}'   # substitute logical name
  - match: '*'            # catch‑all
    provider: openai
    modelId: '$MODEL'    # pass through unchanged
```

## Operations

**Hot‑reload:** Config file write → `POST /control/reload` (or automatic watcher; keep‑last‑valid on parse error)

**Control plane** (requires `controlPlane.token`):

- `GET /control/routing` — dump current model routing table
- `POST /control/reload` — reload config from disk

**Observability:** Each request logs a cache line (`HIT`/`PARTIAL`/`MISS`/`COLD`/`NOUSAGE` with hit %). Set `PROXITOR_DUMP_BODY=1` to write paired request/response dumps to `~/.cache/proxitor/dumps`.

**Graceful shutdown:** `SIGINT`/`SIGTERM` → drain (close idle connections) → exit. Press twice to force.

## Migration from 0.20.x

**Breaking:** The config format is completely replaced. Old `provider.order`, `presets`, `openrouterKey`, `attributionReferer`, `normalizeResponses`, `modelOverrides`, and `cacheControl` semantics are **not** in v1.

**What to do:**

1. **Run the wizard** — `proxitor config wizard` generates a v1 config
2. **Update client URLs** — `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL` now point at the v1 gateway
3. ** `/v1/responses`** — returns `501 Not Implemented` in v1 (endpoint removed)

## Contributing

PRs welcome — see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, tests, commits, and changesets.

## License

[MIT](./LICENSE)
