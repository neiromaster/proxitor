---
"proxitor": minor
---

Rename passthrough sentinel `never` → `skip`

- The config value `never` (passthrough: leave the client value untouched, inject nothing) is renamed to `skip` across `cacheControl`, `sessionId`, and `cacheControlTtl`. `never` is no longer accepted — set `skip` instead. `omit` (strip) is unchanged.
- `never` was temporal and clashed with its passthrough semantics; `skip` reads more clearly.
