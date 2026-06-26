---
'proxitor': minor
---

New cache observability for proxied requests. Each request now logs a cache
outcome line at info level — `HIT`/`PARTIAL`/`MISS`/`COLD`/`NOUSAGE` with cache
hit %, token counts, provider, and request type — so cache behavior is visible
without inspecting upstream responses. Outcomes are captured on every
termination path (clean stream, HTTP error, client abort, non-JSON content
type), so no request is silently unobserved.

Set `PROXITOR_DUMP_BODY=1` to additionally write paired request+response dumps
(with provider routing metadata) to the dump directory.

The observability knobs — `hitThreshold`, `sessionMaxEntries`, `sessionTtlMs`,
`sideMaxTokens`, `routerMetadata` — live-reload with the config file.
