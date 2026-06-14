# proxitor

<p align="center">
  <strong>A friendly proxy between your AI CLI tools and OpenRouter.</strong><br/>
  Route requests to the provider you want. Keep prompt caching alive. Cut costs.<br/>
  Your tools don't even notice.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/proxitor"><img src="https://img.shields.io/npm/v/proxitor?color=6366f1&labelColor=1e2327&label=npm" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?labelColor=1e2327" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-3b82f6?labelColor=1e2327" alt="Node.js ≥ 22">
</p>

🌍 **English** · [Русский](./docs/README.ru.md)

<p align="center"><img src="./docs/assets/proxitor-wizard.gif" alt="proxitor setup wizard" width="640"></p>

---

Proxitor sits between Claude Code (or Codex, or any Anthropic/OpenAI-compatible CLI) and [OpenRouter](https://openrouter.ai). One API key, every model — but **you** decide which provider serves each request, and you make prompt caching actually work.

```
your AI CLI  →  proxitor  →  OpenRouter  →  the provider you picked
```

## Why you'd want this

OpenRouter is convenient — one key, every model. But it load-balances across providers, and **prompt caching is provider-scoped**: a cache built on Anthropic doesn't help when the next request lands on DeepInfra. Claude Code sends a big system prompt on every request, so without a pinned provider you pay full price every time.

Pin `claude-*` to `anthropic`, and that system prompt gets cached after the first hit. Subsequent requests cost a fraction.

A few other things it's good for:

- **Cost control** — route specific models to cheaper providers when caching isn't the priority.
- **Automatic fallbacks** — Anthropic down? Fall back to DeepInfra without touching your tools.
- **Mixed routing** — `claude-*` on Anthropic, `gpt-*` on Azure, different rules per model.
- **Privacy** — enforce `dataCollection: deny` or zero-data-retention across everything.

> Proxitor injects all of this transparently. Your tools see a normal API. Nothing on their side changes.

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

## Configuring it

The friendly way: an interactive menu — no YAML required.

```sh
proxitor config         # open the menu
proxitor config wizard  # (re)run guided setup
```

From the menu you can set your API key and connection, pick routing per model (with live provider pricing), tune caching, and add or edit model overrides. It pulls live data from OpenRouter, so you browse real models and providers with up-to-date prices.

Prefer to edit a file? The full **[configuration reference](./docs/configuration.md)** covers provider routing, per-model overrides, headers, caching modes, and every option. [`proxitor.config.example.yaml`](./proxitor.config.example.yaml) is a commented template.

## Adding a model override

Pin a model — or a wildcard like `claude-*` — to specific providers, straight from the menu. It pulls live pricing and latency for every provider of that model.

<p align="center"><img src="./docs/assets/proxitor-add.gif" alt="proxitor: add a model override" width="640"></p>

## When something's off

```sh
proxitor doctor   # checks environment, config, key, network, port, version
```

It prints a clear report and exits non-zero if anything fails — handy from CI too (`--json`, `--offline`, `--timeout`).

While proxitor runs, it logs cache usage from upstream so you can see whether caching is actually helping:

```
[abc123] Cache read: 50000, write: 25000 tokens (99.6% hit)
```

Quick health poke: `curl http://localhost:8828/health`.

## Commands at a glance

```sh
proxitor                 # start the proxy (the default command)
proxitor config          # interactive config menu
proxitor config wizard   # guided setup
proxitor config browse   # explore models + pricing
proxitor doctor          # diagnose everything
proxitor --help          # the rest of the flags
```

Common flags: `--port`, `--host`, `--config <path>`, `--openrouter-key <key>`. Run `proxitor --help` and `proxitor config --help` for the full list.

## Contributing

PRs welcome — see **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup, tests, commits, and changesets.

## License

[MIT](./LICENSE)
