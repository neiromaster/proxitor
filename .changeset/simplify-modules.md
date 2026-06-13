---
"proxitor": patch
---

Simplify internal logic across modules and canonicalize upstream header casing

- **Header canonicalization**: merged upstream request headers are now lowercased via a new pure `lowercaseKeys()` helper, so a case-variant header (e.g. a user-config `Content-Type` / `CONTENT-TYPE`) can no longer coexist with its lowercase form and corrupt the forwarded `content-type`. Fixes a latent bug where an odd-cased extra header produced a merged value like `text/xml, application/json` upstream.
- **Pure header helpers**: `applyProxyHeaders`/`applyExtraHeaders`/`forceJsonContentType` rewritten as pure producers/transformers (`proxyHeaders`, `sanitizeExtraHeaders`, `withSessionId`, `withJsonContentType`) composed via object spread — no mutation or `delete`.
- **CLI**: reuse `jsonFlag`, drop redundant `?? undefined`, extract `INFO_FLAGS`, collapse default-subcommand and `config`/`menu` injection logic.
- **Config**: reuse `getConfigSearchPaths()` in `tryFindConfigFile`, simplify `cacheControlTtl` override normalization and `openrouterKey` resolution.
- **OpenRouter data client**: drop redundant `OPENROUTER_FALLBACK_URL` alias, extract shared `isValidArrayDataResponse`, add missing-API-key guard in `probeUpstream`.
- **Proxy utils/middleware**: simplify `cache-control`, `error`, `session-id`, and `forward-request` internals.
- **Tests**: add `tests/unit/headers.test.ts` (AAA) and `tests/integration/header-casing.test.ts` regression.
