---
"proxitor": minor
---

Add `rewriteBlockTtl` (`auto` / `always` / `skip`, default `skip`): normalizes the TTL on the client's existing block-level `cache_control` breakpoints (`system`, `tools`, `messages[].content`) to match the configured `cacheControlTtl`. This fixes Anthropic rejecting requests where the root `ttl` is `1h` while Claude Code's block breakpoints stay at `5m` (mixed TTLs). It only rewrites breakpoints the client already placed (respects Anthropic's ≤4-breakpoint limit), reuses the `cacheControlTtl` value, and is opt-in. Set it from `proxitor config` → 💾 Caching → Activate caching (third step: mode → TTL → rewrite block TTLs), or per-model in the override editor; documented in the configuration reference.
