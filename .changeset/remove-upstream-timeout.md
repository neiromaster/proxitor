---
"proxitor": minor
---

Remove upstream request timeout — trust the upstream (OpenRouter) to enforce its own deadline and the client to cancel if it gives up.

- **Breaking**: removed `upstreamTimeoutMs` config option (default was 5 minutes). The proxy no longer aborts upstream requests on its own timer; a slow OpenRouter response will stream as long as it takes, and Anthropic SSE generations of any length are no longer cut off mid-stream.
- **Client cancellation** is still honored — when the client disconnects, the proxy aborts the upstream fetch and returns `499 Client Closed Request` (previously this surfaced as `500` via the global error handler).
- **Network-level failures** (ECONNREFUSED, DNS, connection reset) still return `502 Bad Gateway` with `proxy_upstream_error` — the documented contract is preserved.
