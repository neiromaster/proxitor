---
"proxitor": minor
---
`normalizeResponses` is now a boolean (`true`/`false`, default `true`), not a
tri-state (`auto`/`always`/`skip`). It repairs `/v1/responses` bodies for
OpenRouter and acts on `/v1/responses` only.

The `always`/`auto`/`skip` distinction is removed: `always` was already a no-op
off `/v1/responses` (the normalizer keys off `body.input`, which is absent on
messages/chat-completions), so on/off captures the whole real surface.

Migration (config schema change): `normalizeResponses: always` or `auto` → drop
the key (defaults to `true`); `normalizeResponses: skip` → `normalizeResponses:
false`. Configs still holding the old string values are rejected by the schema
on reload (the proxy keeps the last valid config).
