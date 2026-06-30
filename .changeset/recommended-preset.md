---
'proxitor': minor
---

Add a `recommended` config flag (and `--recommended` / `--no-recommended` CLI flags) that
enables a curated set of caching + fixes. The proxy is now a pure passthrough by default:
`cacheControl`, `sessionId`, and `normalizeResponses` are no longer on out of the box — set
`recommended: true` (or each flag individually) to turn them on. `normalizeVolatileSystem` is
part of the recommended preset.
