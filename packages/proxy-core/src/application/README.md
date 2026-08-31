# Application layer

The orchestration core of the gateway (spec §9): `ProxyPipeline` composes inbound
decoding, domain routing, the plugin lifecycle, upstream transport, stream
transforms, and outbound re-encoding across wire formats.

- `upstream-fetch.ts` — `UpstreamFetchPort`, the sole network-egress port. The
  application encodes and decodes; the adapter (M5) transports.
- `credentials.ts` — `CredentialResolverPort` for `{env}`/`{file}` credential
  refs, and `resolveAuthHeader` (bearer / x-api-key / custom header / none).
- `upstream-headers.ts` — the §5.4 upstream header policy: strip auth and
  hop-by-hop headers, forward an explicit allowlist, protect provider and core
  headers from plugin overrides.
- `plugin-manager.ts` — activation of effective plugin lists against the
  registry (config-gated, fail-loud) plus snapshot/restore for state handoff.
- `proxy-pipeline.ts` — `PipelineRequest`/`PipelineResponse`, the request-side
  stages (classify → decode → route → onRequest chain → ShortCircuit), the
  upstream/response stages (encode → fetch → decode → transformStream →
  onEvent → re-encode), `/v1/models` synthesis, and model-less raw passthrough.

All I/O sits behind ports; tests run entirely on fakes. The M5 adapters (hono
inbound, fetch upstream, config file) implement them at the composition root.
