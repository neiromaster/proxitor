---
"proxitor": minor
---

Add `cacheControl` and `sessionId` options for automatic prompt caching through OpenRouter

- **`cacheControl`** (`auto`/`always`/`never`, default `auto`) — injects `cache_control: { "type": "ephemeral" }` to enable OpenRouter prompt caching. In `auto` mode, injection is endpoint-safe: `/v1/messages` and `/v1/responses` always get it; `/v1/chat/completions` only for Anthropic models (non-Anthropic providers may reject it with 400). Per-model overrides supported.
- **`sessionId`** (`auto`/`always`/`never`, default `auto`) — injects `session_id` for provider sticky routing from the first request. In `auto` mode, derives from the `X-Claude-Code-Session-Id` header sent by Claude Code. The `x-session-id` header is also forwarded to upstream, and the client header is stripped from forwarded requests.
- Refactored body injection into a single-pass `injectBodyFields()` replacing separate functions, reducing overhead for large request bodies.
- Extracted `findBestMatch()` and `applyOverride()` from `resolveModelConfig()` to reduce cognitive complexity.