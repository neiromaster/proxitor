---
"proxitor": patch
---

`rewriteBlockTtl` now rewrites message-level and `tool_calls` cache_control.

It previously descended only into `messages[].content`, so `cache_control` on
`messages[].cache_control` (the OpenRouter/OpenAI message-level convention) and
on `messages[].tool_calls[].cache_control` stayed at the client's ttl-less 5m
while the rest were rewritten to `cacheControlTtl` — Anthropic rejected the
mixed ordering with `400 ... a ttl='1h' cache_control block must not come after
a ttl='5m' cache_control block`. Both locations are rewritten too now.
