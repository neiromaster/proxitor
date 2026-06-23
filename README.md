# proxitor

<p align="center">
  <strong>Transparent proxy for AI CLI tools.</strong><br/>
  Pin providers. Keep prompt caching alive. Cut costs.<br/>
  Your tools don't even notice.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
  <a href="https://github.com/neiromaster/proxitor/issues"><img src="https://img.shields.io/github/issues/neiromaster/proxitor?color=f59e0b&labelColor=1e2327&label=issues" alt="GitHub issues"></a>
</p>

🌍 **English** · [Русский](./docs/README.ru.md)

<p align="center"><img src="./docs/assets/proxitor-wizard.gif" alt="proxitor setup wizard" width="640"></p>

---

## How it works

```
your AI CLI  →  proxitor  →  OpenRouter  →  the provider you picked
```

Proxitor sits between Claude Code, Codex, or any Anthropic/OpenAI-compatible CLI and [OpenRouter](https://openrouter.ai). One API key, every model — but **you** decide which provider serves each request, and you make prompt caching actually work.

## The caching problem

OpenRouter load-balances across providers, and **prompt caching is provider-scoped**: a cache built on Anthropic doesn't help when the next request lands on DeepInfra. Claude Code sends a big system prompt on every request, so without a pinned provider you pay full price every time.

Pin `claude-*` to `anthropic`, and that system prompt gets cached after the first hit. Subsequent requests cost a fraction.

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
proxitor
# Listening on http://0.0.0.0:8828
```

**3. Point your tool at it**

```sh
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:8828/v1 claude

# Codex
OPENAI_BASE_URL=http://localhost:8828/v1 codex
```

That's the whole setup. Requests flow through proxitor; streaming responses pass through untouched.

## Configuration

The friendly way: an interactive menu — no YAML required.

```sh
proxitor config         # open the menu
proxitor config wizard  # (re)run guided setup
proxitor config browse  # explore models + pricing
```

From the menu you can set your API key and connection, pick routing per model (with live provider pricing), tune caching, and add or edit model overrides. It pulls live data from OpenRouter, so you browse real models and providers with up-to-date prices.

<p align="center"><img src="./docs/assets/proxitor-add.gif" alt="proxitor: add a model override" width="640"></p>

Prefer to edit a file? The full **[configuration reference](./docs/configuration.md)** covers provider routing, per-model overrides, headers, caching modes, and every option. [`proxitor.config.example.yaml`](./proxitor.config.example.yaml) is a commented template.

## Diagnostics

```sh
proxitor doctor   # checks environment, config, key, network, port, version
```

It prints a clear report and exits non-zero if anything fails — handy from CI too (`--json`, `--offline`, `--timeout`).

While proxitor runs, it logs cache usage from upstream so you can see whether caching is actually helping:

```
[abc123] Cache read: 50000, write: 25000 tokens (99.6% hit)
```

Quick health poke: `curl http://localhost:8828/health`.

### Tuning the cache

If the cache hit looks low, three levers fix it — tune them from `proxitor config` → **💾 Caching** (or `proxitor config cache`):

- **`cacheControl`** — inject `cache_control` to activate caching (Anthropic-native).
- **`sessionId`** — inject `session_id` so the provider pins from the first request.
- **`normalizeVolatileSystem`** — strip Claude Code's volatile `cch`/`cc_version` hashes so the prefix cache warms on non-Anthropic providers (qwen/glm/…).
- **`rewriteBlockTtl`** — normalize the TTL on Claude Code's block `cache_control` breakpoints to match your `cacheControlTtl`. Enable it (`auto`/`always`) if Anthropic rejects requests where the root `ttl` is `1h` but the block breakpoints stay at `5m`.

See the [configuration reference](./docs/configuration.md#prompt-caching) for the full detail.

## Commands

| Command | Description |
|---|---|
| `proxitor` | Start the proxy (default command) |
| `proxitor config` | Interactive config menu |
| `proxitor config wizard` | Guided setup |
| `proxitor config browse` | Explore models + pricing |
| `proxitor doctor` | Diagnose everything |
| `proxitor --help` | Full list of flags |

Common flags: `--port`, `--host`, `--config <path>`, `--openrouter-key <key>`.

## Contributing

PRs welcome — see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, tests, commits, and changesets.

## License

[MIT](./LICENSE)
