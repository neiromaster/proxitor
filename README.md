# proxitor

> Lightweight proxy for routing CLI requests (claude-code, codex) to [OpenRouter](https://openrouter.ai)

## Why

When using AI CLI tools like Claude Code or Codex, you may want to route requests through OpenRouter for model selection, cost control, or unified API access. Proxitor sits between your CLI tools and OpenRouter, injecting [provider routing](https://openrouter.ai/docs/api/reference/streaming) into requests and streaming responses back unchanged — including SSE streams from LLM models.

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

### Provider routing

Control which upstream provider handles your requests. Both `only` and `order` accept a single string or an array:

```yaml
# Use a single provider exclusively (no fallbacks)
provider:
  only: "deepinfra"

# Use multiple providers exclusively
provider:
  only:
    - "openai"
    - "azure"

# Prefer a provider, allow fallbacks
provider:
  order: "anthropic"
  allowFallbacks: true

# Try providers in order
provider:
  order:
    - "anthropic"
    - "deepinfra"
  allowFallbacks: false
```

Without `provider` configured, the proxy forwards requests unchanged.  
See the [OpenRouter provider routing docs](https://openrouter.ai/docs/guides/routing/provider-selection) for the full list of supported providers.

### Per-model overrides

Route different models to different providers using `modelOverrides`. Keys are exact model names or prefix patterns (e.g. `claude-*`). Overrides layer on top of global settings — `provider` replaces the global value, `headers` merge:

```yaml
provider:
  order: "deepinfra"

modelOverrides:
  # Exact match — force Anthropic models to Anthropic's own infrastructure
  "claude-sonnet-4-6":
    provider:
      only: "anthropic"

  # Wildcard — all Claude models prefer Anthropic with fallback
  "claude-*":
    provider:
      order:
        - "anthropic"
        - "deepinfra"

  # Wildcard — GPT models to OpenAI/Azure, plus a custom header
  "gpt-*":
    provider:
      only:
        - "openai"
        - "azure"
    headers:
      X-Model-Family: "gpt"
```

When a model name matches multiple patterns, the most specific match wins (exact name > longer prefix > shorter prefix).

### Custom headers

Add custom headers to all proxied requests, or per-model via `modelOverrides`:

```yaml
# Global custom headers
headers:
  X-Custom-Header: "my-value"
  X-Environment: "production"

# Per-model headers (merged on top of global)
modelOverrides:
  "claude-*":
    headers:
      X-Custom-Header: "claude-override"  # overrides global value
      X-Extra: "only-for-claude"          # added only for this model
```

### Health check

```bash
curl http://localhost:8080/health
```

## CLI Options

```text
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
