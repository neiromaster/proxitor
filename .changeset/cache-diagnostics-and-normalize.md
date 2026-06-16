---
"proxitor": minor
---

New opt-in tools to diagnose and stabilize prompt-cache behavior:

- **Body-dump diagnostics** — set `PROXITOR_DUMP_BODY=1` to write one file per
  request (`<timestamp>_<model>_<reqId>.json`) containing the forwarded request
  body and the upstream cache usage (read/write/hit%). For offline prefix-cache
  analysis. Zero overhead when disabled.
- **Normalize volatile system** — new `normalizeVolatileSystem` config flag
  (global or per-model override, also exposed in `proxitor config` under
  *Global Settings*) rewrites Claude Code's per-request `cch=…` hash in the
  system prompt to a constant, keeping the prefix cache byte-stable across
  turns for non-Anthropic providers (qwen/glm/etc.). Off by default.

Internal: `parse-body` only parses `application/json` bodies; streaming
responses no longer buffer fully in memory (O(1) rolling tail).
