# @proxitor/proxy-core

## 0.100.0-beta.0

### Minor Changes

- 4554c19: # proxitor 0.100.0 — multi-provider plugin gateway (v1 engine)
  
  Complete rewrite as a multi-provider LLM gateway. Point any Anthropic- or OpenAI-compatible client at one local endpoint and route each model to any provider, with a plugin pipeline over a Canonical IR.
  
  **Breaking:** the configuration format is fully replaced (run `proxitor config wizard` to regenerate); all OpenRouter-specific options are gone (`provider.only/order/sort`, `openrouterKey`, `attribution*`, `normalizeResponses`, …); `/v1/responses` returns 501 (deferred, see spec §17).
  
  - **Routing:** YAML table of providers + glob model bindings (`*` wildcard, case-insensitive, first-match-wins, `$MODEL` passthrough), model-less default provider, locally synthesized `/v1/models`.
  - **Wire translation:** anthropic-messages ⇄ openai-chat in both directions over a Canonical IR — requests, streaming responses, tool use, and wire-error mapping, end to end.
  - **Plugin pipeline:** three merge layers (global → provider → model) with disable/re-enable semantics; four built-ins (`cache-control`, `normalize-volatile-system`, `session-id`, `openrouter-routing`); write your own against the published `@proxitor/plugin-api` contract.
  - **Observability:** per-request cache-outcome lines (HIT/PARTIAL/MISS/COLD/NOUSAGE with hit %), session warm/cold tracking, `PROXITOR_DUMP_BODY=1` paired body dumps.
  - **Hot reload:** config file watching with keep-last-valid on errors, inflight-request snapshot isolation, `/control/reload` + `/control/routing` behind a timing-safe token; graceful drain shutdown with second-Ctrl-C force exit.
  - **Ops:** `config` wizard (with shadowed-config detection), `doctor` health checks, XDG/home config discovery, per-provider credential env indirection.
  
  `@proxitor/proxy-core` is bumped in lockstep (private package) so the CLI stamps the release version; both are pinned to 0.100.0 at release time.
- 4554c19: # Fix wave — hot-reload correctness, pipeline robustness, config/plugin behavior
  
  Fixes landing on the 0.100.0 beta ahead of release, grouped by theme; internal refactors are listed only where they touched observable surfaces.
  
  **Hot reload & credentials**
  - Credential file refs are re-read on every preload into a fresh cache that is swapped in only on complete success: rotated key files are picked up by reload, refs removed from the config stop being served, and a failed reload keeps the previous credentials (keep-last-valid).
  - `controlPlane.token` is resolved per request from the live config: reloads rotate the token without a restart and adding/removing `controlPlane` applies via reload. An absent or unresolvable token answers 404 with the proxy not-found shape (fail closed, identical to the unmounted state).
  - Configs loaded from `configText` reload correctly now — the stored text is re-parsed instead of attempting to read a `<memory>` path, which made every reload fail before.
  - The `forwardHeaders` restart-key comparison is order-insensitive, so reordering the same set no longer triggers a spurious restart warning; `logging` changes are now covered by the restart warning and the reload diff summary.
  - `logging.verbose` is live config (the knob previously had zero consumers) and emits one `[req] model= provider= status= cache=` line per completed request.
  
  **Request pipeline & streaming**
  - Encode and auth failures inside the upstream window (format errors such as an unexpressible `top_k`, credential-resolution throws) are answered in the client's inbound shape instead of escaping to the terminal catch, which forced openai-chat for every inbound format.
  - Observability records no longer report false 200s: non-stream responses end with 200 only after encoding succeeds (short-circuits included — a failed short-circuit encode records the error status, not the requested one), streaming ends with the emitted error frame's status, and encode/auth failures end the observation with the canonical status.
  - A client disconnect aborts the in-flight upstream fetch directly instead of relying on generator unwinding, which could stall forever behind a pending read on a hung upstream, and the aborted request is recorded as 499 (client closed request) rather than as a server 500.
  - The pipeline's dead duplicate 405 branch for `/v1/models` was removed; behavior is unchanged — GET `/v1/models` still synthesizes the listing and non-GET methods still answer 405.
  - Dump bodies queued at shutdown are drained before exit (exposed as `Proxitor.drain()`); the second Ctrl-C force exit stays fully synchronous.
  
  **Config & plugins**
  - The documented provider knob `unsupportedParams: error | drop` is implemented: `drop` silently omits params the outbound format cannot express (`seed`, `response_format`, penalties for anthropic-messages; `top_k` for openai-chat), the default stays `error`, and required params (`max_tokens`) always fail.
  - A model-less request without `defaultProvider` returns 404 (was 501).
  - The documented `{ disable: [name, ...] }` bulk plugin-disable syntax works as specified: removal matches `{ name: false }`, unknown names no-op, and a later entry re-adds the plugin.
  - Plugins incompatible with a route's wire format are skipped at activation with a warn per (plugin, route) pair — matching the docs' "does not affect" promise — instead of failing startup or answering request-time 500s; the request-time warn fires once per plugin and format instead of once per request. Unknown plugin names and rejected plugin configs still fail at load.
  - Auth header protection is case-insensitive: plugin `outboundHeaders` cannot override the auth header under any casing.
  - The `session-id` built-in honors the client's session id (`x-claude-code-session-id` / `x-session-id`) via `CanonicalRequest.clientSessionId` before falling back to the derived id; an empty client header no longer shadows the other one.
  - `proxitor doctor` reports format-incompatible plugin skips as warn-level activation checks naming the plugin and route, instead of showing a silent ok; warns do not affect the exit code.
  - `provider.headers` values are logged as `[redacted]` in the startup config log (keys preserved — names are configuration, not secrets).
  
  Internal cleanups with no behavior change: shared stop-reason tables and stream passthrough helper, single `$proxitor.` prefix, `RESERVED_KEYS` sourced from plugin-api, one shared `messageOf`, `joinEndpointPath` extraction, and removal of the dead plugin state-handoff chain.
