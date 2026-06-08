---
"proxitor": minor
---

Add `cacheControlTtl` option for Anthropic prompt cache TTL control

- **`cacheControlTtl`** (`'5m'` | `'1h'`, optional) — controls the cache time-to-live for Anthropic models. Without it, Anthropic's default 5-minute TTL applies. Set to `'1h'` for a 1-hour cache (2× write cost vs 1.25×, same 90% read discount). TTL is only injected for Anthropic models/endpoints — other providers don't support it.
- **`null` in model overrides** — per-model `cacheControlTtl` accepts `null` to cancel a global TTL and revert to Anthropic's default behavior for specific models.
- **Existing `cache_control` handling** — when the request body already contains `cache_control` without `ttl`, proxitor adds `ttl` if configured. If `ttl` is already present, it's preserved unchanged.
