---
"proxitor": minor
---
Add `normalizeMessages` to lift stray `role:"system"` items out of the
`messages` array on `/v1/messages` requests. The Anthropic Messages API allows
only `user`/`assistant` in `messages` — a mid-thread `role:"system"` (e.g. an
injected `SessionStart` hook payload) is rejected by strict Anthropic-format
providers (OpenRouter → GLM and others) with `400 ... messages[n].role: Input
should be 'user' or 'assistant'`. The new normalizer (on by default for
`/v1/messages`) moves each system item's text into the top-level `system` field
and drops it from `messages`, which also preserves `user`/`assistant`
alternation. Configurable via `normalizeMessages: auto | always | skip` (and
per-model overrides).
