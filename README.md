# proxitor

<p align="center">
  <strong>Transparent proxy for AI CLI tools.</strong><br/>
  Pin providers. Keep prompt caching alive. Cut costs.<br/>
  Your tools don't even notice.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="https://github.com/neiromaster/proxitor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/neiromaster/proxitor/ci.yml?branch=main&color=22c55e&labelColor=1e2327&label=CI" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <a href="https://github.com/neiromaster/proxitor/issues"><img src="https://img.shields.io/github/issues/neiromaster/proxitor?color=f59e0b&labelColor=1e2327&label=issues" alt="GitHub issues"></a>
</p>

🌍 **English** · [Русский](./docs/README.ru.md)

<p align="center"><img src="./docs/assets/proxitor-wizard.gif" alt="proxitor setup wizard" width="640"></p>

---

## Contents

- [Why proxitor](#why-proxitor)
- [How it works](#how-it-works)
- [The caching problem](#the-caching-problem)
- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Minimal config](#minimal-config)
- [Configuration](#configuration)
- [Diagnostics](#diagnostics)
- [Commands](#commands)
- [Common pitfalls](#common-pitfalls)
- [Contributing](#contributing)
- [License](#license)

## Why proxitor

AI CLIs already speak Anthropic or OpenAI APIs. proxitor keeps that interface intact and fixes the expensive parts in the middle:

- **Provider pinning** keeps OpenRouter from bouncing the same conversation between upstreams.
- **Prompt-cache shaping** adds sticky sessions, cache breakpoints, TTL fixes, and volatile-prefix normalization where needed.
- **Per-model routing** lets Claude, GPT, Qwen, GLM, and other model families use different providers and policies.
- **Operational checks** (`doctor`, `/health`, config validation, hot reload) make the proxy safe to leave running during long coding sessions.

## How it works

```text
your AI CLI  →  proxitor  →  OpenRouter  →  the provider you picked
```

Proxitor sits between Claude Code, Codex, or any Anthropic/OpenAI-compatible CLI and [OpenRouter](https://openrouter.ai). One API key, every model — but **you** decide which provider serves each request, and you make prompt caching actually work.

## The caching problem

OpenRouter load-balances across providers, and **prompt caching is provider-scoped**: a cache built on Anthropic doesn't help when the next request lands on DeepInfra. Claude Code sends a big system prompt on every request, so without a pinned provider you pay full price every time.

Pin `claude-*` to `anthropic`, and that system prompt gets cached after the first hit. Subsequent requests cost a fraction.

A typical 50k-token Claude Code system prompt at $3/M input costs **$0.15 per turn** with no cache. After a warm Anthropic cache, the same prefix costs ~10% of input price — about **$0.015 per turn**. The cache amortizes in 1-2 turns and pays for itself the rest of the session.

## Features

- 🔒 **Stable caching** — pin models to a single provider so prompt caches survive across requests
- 💰 **Cost control** — route specific models to cheaper providers when caching isn't the priority
- 🔄 **Automatic fallbacks** — Anthropic down? Fall back to DeepInfra without touching your tools
- 🎯 **Mixed routing** — `claude-*` on Anthropic, `gpt-*` on Azure, different rules per model
- 🛡️ **Privacy** — enforce `dataCollection: deny` or zero-data-retention across everything
- 🔌 **Transparent** — your tools see a normal API; nothing on their side changes

## Install

Requires **Node.js 22+**.

```sh
npm install -g proxitor
# or:  pnpm install -g proxitor
# or:  bun install -g proxitor
# or run it once, no install:  npx proxitor
```

## Quick start

**1. Set it up** — the wizard asks a few questions and writes your config:

```sh
proxitor config wizard
```

**2. Run it**

```sh
proxitor                  # default: http://0.0.0.0:8828
proxitor --port 9000      # or pick a custom port
proxitor up               # aliases: up, run
```

**3. Point your tool at it**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:8828/v1 claude

# Codex
OPENAI_BASE_URL=http://localhost:8828/v1 codex
```

That's the whole setup. Requests flow through proxitor; streaming responses pass through untouched.

## Minimal config

The wizard writes a full config; the minimum is just an API key and a routing rule. Drop this into `proxitor.config.yaml` (or `.yaml`/`.yml`/`.json`, also accepted as `.proxitor.yaml`/`.proxitor.json` in the project root):

```yaml
openrouterKey: sk-or-v1-...   # or set OPENROUTER_API_KEY in your shell
provider:
  order: "anthropic"           # pin everything to Anthropic for stable caching
```

Run `proxitor config validate` to check it, then `proxitor` to start.

## Configuration

The friendly way: an interactive menu — no YAML required.

```sh
proxitor config         # open the menu
proxitor config wizard  # (re)run guided setup
proxitor config browse  # explore models + pricing
```

From the menu you can set your API key and connection, pick routing per model (with live provider pricing), tune caching, and add or edit model overrides. It pulls live data from OpenRouter, so you browse real models and providers with up-to-date prices. The model picker is **fuzzy** — type `claudops` to land on `anthropic/claude-opus`, `gpt4o` for `openai/gpt-4o`; matches rank by relevance so the best fit surfaces first.

<p align="center"><img src="./docs/assets/proxitor-add.gif" alt="proxitor: add a model override" width="640"></p>

Prefer to edit a file? The full **[configuration reference](./docs/configuration.md)** covers provider routing, per-model overrides, headers, caching modes, and every option. [`proxitor.config.example.yaml`](./proxitor.config.example.yaml) is a commented template.

**Hot-reload** — proxitor watches the config file and reloads on save; no restart needed. Bad edits fall back to the last valid config and the proxy keeps running. `proxitor config validate` shows the current state.

**Environment variables** — `OPENROUTER_API_KEY` is used when the config key is empty; `XDG_CONFIG_HOME` overrides the user-config directory on Linux/macOS. CLI flags take precedence over both.

## Diagnostics

```sh
proxitor doctor   # checks environment, config, key, network, port, version
```

It prints a clear report and exits non-zero if anything fails — handy from CI too (`--json`, `--offline`, `--timeout`).

While proxitor runs, it prints a classified per-request cache line — `HIT` / `PARTIAL` / `MISS` / `COLD` / `NOUSAGE`, the hit percentage, the provider that served the request, and the request type (`[main]`/`[side]`) — so you can see at a glance whether caching is actually helping:

```text
[a1b2] HIT   99%  read 48640  in 48874  glm-4.5-air  [main]
```

See **Configuration → [Cache observability](./docs/configuration.md#cache-observability)** for the full label reference, the `observability:` config block, and enriched dumps.

Quick health poke: `curl http://localhost:8828/health`.

### Tuning the cache

If the cache hit looks low, four levers fix it — tune them from `proxitor config` → **💾 Caching** (or `proxitor config cache`):

- **`cacheControl`** — inject `cache_control` to activate caching (Anthropic-native).
- **`sessionId`** — inject `session_id` so the provider pins from the first request.
- **`normalizeVolatileSystem`** — strip Claude Code's volatile `cch`/`cc_version` hashes so the prefix cache warms on non-Anthropic providers (qwen/glm/…).
- **`rewriteBlockTtl`** — normalize the TTL on Claude Code's block `cache_control` breakpoints to match your `cacheControlTtl`. Enable it (`auto`/`always`) if Anthropic rejects requests where the root `ttl` is `1h` but the block breakpoints stay at `5m`.

See the [configuration reference](./docs/configuration.md#prompt-caching) for the full detail.

## Commands

| Command | Description |
| --- | --- |
| `proxitor` | Start the proxy (default command) |
| `proxitor config` | Interactive config menu |
| `proxitor config wizard` | Guided setup |
| `proxitor config browse` | Explore models + pricing |
| `proxitor config add` | Add a model override |
| `proxitor config edit` | Edit an existing model override |
| `proxitor config remove` | Remove a model override |
| `proxitor config list` | List all model overrides (also `--json`) |
| `proxitor config cache` | Tune prompt-caching settings |
| `proxitor config show` | Print the resolved config |
| `proxitor config validate` | Check the config (exit 0 ok, 1 invalid — CI-friendly) |
| `proxitor doctor` | Diagnose everything |
| `proxitor --version` | Print version |
| `proxitor --help` | Full list of flags |

Common flags: `--port`, `--host`, `--config <path>`, `--openrouter-key <key>` / `-k <key>`, `--verbose`, `--no-config`.

## Common pitfalls

**Cache reads stay at 0 even after several requests.** The prefix usually churns every turn (Claude Code's `cch`/`cc_version` hashes) — enable `normalizeVolatileSystem: true` and confirm the request actually lands on the same provider. `proxitor doctor` reports the loaded config; the cache-read log in the proxy console reports hits.

**Anthropic returns `400` about mixed TTLs when `cacheControlTtl: 1h`.** Set `rewriteBlockTtl: auto` (or `always`) to normalize the client's block-level `cache_control` breakpoints to the same TTL — see the [configuration reference](./docs/configuration.md#prompt-caching).

**OpenRouter returns `400 invalid_prompt | Invalid Responses API request` on `/v1/responses`.** Some clients send Responses `input` items without the `type` field OpenRouter requires. `normalizeResponses: auto` (the default) tags them, lifts `role:"system"` into `instructions`, and adds the `id`/`status` OpenRouter wants on assistant history. Set it to `skip` only for raw passthrough.

**Strict providers reject `role:"system"` inside `/v1/messages`.** Some clients (e.g. an injected `SessionStart` hook payload) place a `role:"system"` item mid-thread in `messages`; the Anthropic Messages API allows only `user`/`assistant` there, so providers like OpenRouter → GLM return `400 ... messages[n].role: Input should be 'user' or 'assistant'`. `normalizeMessages: auto` (the default) lifts each such item's text into the top-level `system` field and drops it from `messages`. Set it to `skip` only for raw passthrough.

**The provider keeps switching between requests.** Make sure `sessionId` is not `skip` — both `auto` (default) and `always` inject a sticky session ID; without it OpenRouter only pins after the first cache hit.

**Config edits don't take effect.** They should — proxitor hot-reloads on save. If the file is invalid the proxy keeps the last valid config; `proxitor config validate` shows what was rejected.

## Contributing

PRs welcome — see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, tests, commits, and changesets.

## License

[MIT](./LICENSE)
