---
'@proxitor/proxy-core': minor
---

Application core (M4a): `ProxyPipeline` wiring the full request flow — classify, decode, route, plugin hooks, upstream fetch, stream transforms, re-encode — across wire formats, plus `PluginManager` (config-gated activation, state snapshot/restore), the §5.4 upstream header policy, credential resolution with bearer/x-api-key/custom auth, client wire-error bodies via the new `FormatAdapter.encodeError`, `/v1/models` synthesis from the routing table, and model-less raw passthrough through `defaultProvider`.
