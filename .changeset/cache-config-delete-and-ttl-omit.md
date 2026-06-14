---
"proxitor": minor
---

Config menu: delete cache/session overrides + TTL `omit`/`never` model

- `proxitor config edit` and the global `config cache-control` / `config session-routing` commands now support **Reset / inherit** — removes the field so the model inherits the global (or the global reverts to the schema default).
- **`cacheControlTtl`** gains two explicit values:
  - `omit` — strips the `ttl` field from injected `cache_control`, guaranteeing no TTL (even a client-sent one).
  - `never` — passthrough: preserve the client `ttl`, add nothing, ignore an inherited value.
- The ambiguous `cacheControlTtl: null` (model override) is **removed** — migrate to `never`. `null` was undocumented and unsettable from the UI.
- TTL is now decoupled from cache mode in the editor: it can be set independently (it refines the inherited mode).
- Clarified that `cacheControl` / `sessionId` `never` means passthrough (client headers left untouched), not stripping.
