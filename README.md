# proxitor

> Lightweight proxy for routing CLI requests (claude-code, codex) to [OpenRouter](https://openrouter.ai)

## Why

When using AI CLI tools like Claude Code or Codex, you may want to route requests through OpenRouter for model selection, cost control, or unified API access. Proxitor sits between your CLI tools and the provider, forwarding requests to OpenRouter with the right configuration.

## Install

```bash
# npm
npm install -g proxitor

# bun
bun install -g proxitor

# npx (no install)
npx proxitor
```

## Usage

### Start the proxy

```bash
# With env var
OPENROUTER_API_KEY=sk-... proxitor

# With CLI flag
proxitor --openrouter-key sk-...

# With config file
proxitor --config ./proxitor.config.yaml
```

### Configure CLI tools

Point your AI CLI tools at the proxy:

```bash
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:8080/v1 claude

# Codex
OPENAI_BASE_URL=http://localhost:8080/v1 codex
```

## Configuration

Proxitor looks for config files in this order:

1. `proxitor.config.yaml`
2. `proxitor.config.yml`
3. `proxitor.config.json`
4. `.proxitor.yaml`
5. `.proxitor.yml`
6. `.proxitor.json`

See [`proxitor.config.example.yaml`](./proxitor.config.example.yaml) for a full example.

### Priority

CLI flags > config file > environment variables > defaults

## CLI Options

```
proxitor [options]

Options:
  -p, --port <port>             Proxy server port (default: 8080)
  -h, --host <host>             Proxy server host (default: 0.0.0.0)
  -c, --config <path>           Path to config file
  --openrouter-key <key>        OpenRouter API key
  --verbose                     Enable verbose logging
  -v, --version                 Display version
  --help                        Display help
```

## Development

```bash
# Install dependencies
pnpm install

# Run in dev mode with watch
pnpm run dev

# Run tests
pnpm run test

# Type check
pnpm run typecheck

# Lint + format (Biome)
pnpm run check:biome

# Auto-fix lint + format issues
pnpm run lint:fix
pnpm run format

# Build
pnpm run build

# Full check (typecheck + biome + test)
pnpm run check
```

## License

[MIT](./LICENSE)
