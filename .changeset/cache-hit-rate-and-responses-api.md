---
"proxitor": patch
---

Fix cache_control TTL to use string format and add Responses API cache logging

- **TTL fix**: `cache_control.ttl` now sends string values (`"5m"`, `"1h"`) instead of numeric seconds, matching the Anthropic and OpenRouter API spec
- **Responses API SSE**: cache usage extraction now supports the `response` wrapper in SSE events (e.g. `response.completed`, `response.incomplete`), enabling cache logging for the `/v1/responses` endpoint
- **Cache hit rate**: log messages now include hit rate percentage, e.g. `Cache read: 1088 tokens (90.0% hit)`
- **Removed `TTL_SECONDS`** constant — no longer needed since TTL is passed as string
