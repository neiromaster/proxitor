---
"proxitor": minor
---

Add `normalizeResponses` to repair `/v1/responses` bodies OpenRouter rejects.

OpenRouter validates each Responses `input` item as a union discriminated by
`type`, but some clients omit `type` on message items — OpenRouter returns
`400 invalid_prompt | Invalid Responses API request`. The new normalizer (on by
default for `/v1/responses`) tags message items with `type: "message"`, lifts
`role: "system"` items into the top-level `instructions` field, and synthesizes
the `id`/`status` OpenRouter requires on assistant history items. Configurable
via `normalizeResponses: auto | always | skip` (and per-model overrides).
