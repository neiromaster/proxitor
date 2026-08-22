---
'@proxitor/proxy-core': minor
---

Observability + hot-reload + control-plane (M6): always-on cache observability (HIT/PARTIAL/MISS/COLD lines, session tracking, PROXITOR_DUMP_BODY dumps) tapped post-transform/pre-encode on every termination path; config hot-reload with keep-last-valid semantics and inflight snapshot isolation; token-gated control-plane (POST /control/reload, GET /control/routing, 404 without token); graceful drain shutdown with second-Ctrl-C force exit; observability config gains sideMaxTokens/sessionTtlMs; bodyLimit rejects sizes above MAX_SAFE_INTEGER.
