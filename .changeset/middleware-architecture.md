---
"proxitor": minor
---

Refactor proxy request processing into composable Hono middleware architecture

- **Breaking**: removed `injectBodyFields`, `injectProvider`, `buildRequestHeaders`, and `InjectionResult` from public API
- **Breaking**: session_id is now sent exclusively via `x-session-id` header instead of body injection (universal across all OpenRouter endpoints)
- Decomposed monolithic proxy handler into 9 ordered middleware: setupRequest, readBody, parseBody, resolveConfig, injectProvider, injectCacheControl, injectSessionId, buildUpstreamReq, forwardRequest
- Route-based middleware composition: injection middleware only registered on `/v1/chat/completions`, `/v1/responses`, `/v1/messages`; all other paths pass through without overhead
- Eliminated double JSON parse — single parse in parseBody, in-place mutation by injection middleware, single serialize in buildUpstreamReq
- Content-based session ID derivation for clients without session support: SHA-256 fingerprint of model + first system message + first user message gives stable per-conversation stickiness without cross-session pollution
- Session ID sources (priority order): `x-claude-code-session-id` header (Claude Code) → `session_id` from body (Codex CLI) → content hash fingerprint → random UUID fallback
- Shared `ProxyVariables` context type for type-safe data flow across middleware chain
- Global `app.onError()` handler for unhandled errors
