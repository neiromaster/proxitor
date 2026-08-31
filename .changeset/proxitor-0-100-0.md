---
'@proxitor/proxy-core': minor
---

# proxitor 0.100.0 — multi-provider plugin gateway (v1 engine)

Complete rewrite as a multi-provider LLM gateway. Point any Anthropic- or OpenAI-compatible client at one local endpoint and route each model to any provider, with a plugin pipeline over a Canonical IR.

**Breaking:** the configuration format is fully replaced (run `proxitor config wizard` to regenerate); all OpenRouter-specific options are gone (`provider.only/order/sort`, `openrouterKey`, `attribution*`, `normalizeResponses`, …); `/v1/responses` returns 501 (deferred, see spec §17).

- **Routing:** YAML table of providers + glob model bindings (`*` wildcard, case-insensitive, first-match-wins, `$MODEL` passthrough), model-less default provider, locally synthesized `/v1/models`.
- **Wire translation:** anthropic-messages ⇄ openai-chat in both directions over a Canonical IR — requests, streaming responses, tool use, and wire-error mapping, end to end.
- **Plugin pipeline:** three merge layers (global → provider → model) with disable/re-enable semantics; four built-ins (`cache-control`, `normalize-volatile-system`, `session-id`, `openrouter-routing`); write your own against the published `@proxitor/plugin-api` contract.
- **Observability:** per-request cache-outcome lines (HIT/PARTIAL/MISS/COLD/NOUSAGE with hit %), session warm/cold tracking, `PROXITOR_DUMP_BODY=1` paired body dumps.
- **Hot reload:** config file watching with keep-last-valid on errors, inflight-request snapshot isolation, `/control/reload` + `/control/routing` behind a timing-safe token; graceful drain shutdown with second-Ctrl-C force exit.
- **Ops:** `config` wizard (with shadowed-config detection), `doctor` health checks, XDG/home config discovery, per-provider credential env indirection.

`@proxitor/proxy-core` is bumped in lockstep (private package) so the CLI stamps the release version; both are pinned to 0.100.0 at release time.
