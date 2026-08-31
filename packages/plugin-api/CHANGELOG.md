# @proxitor/plugin-api

## 0.1.0-beta.0

### Minor Changes

- 4554c19: Initial published plugin contract: Canonical IR types (request, events, errors, usage), plugin hook definitions, ports, and `ENDPOINT_PATHS` wire-format endpoint ownership; `message_delta` carries an optional `extensions` passthrough for raw wire stop-reason provenance.
- 4554c19: Fix-wave contract updates riding the 0.1.0 beta.
  
  - **Added** `CanonicalRequest.clientSessionId?: string` — the inbound client session hint, stamped by the pipeline from the client's `x-claude-code-session-id` / `x-session-id` headers so plugins can honor it instead of deriving their own id.
  - **Added** exported constants `SESSION_ID_HEADER`, `CLIENT_SESSION_ID_HEADER`, `MODELS_PATH`, and `DEFERRED_RESPONSES_PATH` next to `ENDPOINT_PATHS`.
  - **Removed** the `exportState` / `restoreState` plugin hooks and the `TState` generic on `ProxyPlugin`. The per-instance state handoff across hot reload was dead machinery: registry instances are singletons created once in the composition root, so state survives reload by construction. Plugins implementing these hooks must drop them — a type-level break absorbed inside the beta rather than a major.
