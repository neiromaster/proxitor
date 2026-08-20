# Domain — routing (M3)

Pure, zero-I/O routing core (spec §5). Imports only `@proxitor/plugin-api`
and sibling domain modules (enforced by `domain-layers-isolated` in
`.dependency-cruiser.mjs`).

## Modules

| Module | Responsibility |
| --- | --- |
| `error.ts` | `RoutingError` (request-time, HTTP status) and `RoutingConfigError` (load-time, fail-loud) |
| `glob.ts` | `globMatch` — single-star wildcard, case-insensitive |
| `plugin-merge.ts` | `PluginListEntry` + 3-layer merge (global → provider → binding) with disable/re-enable |
| `provider.ts` | `ProviderConfig` + `validateProvider` (baseUrl `/v1` rules, anthropic-version, auth shape) + `endpointUrl` |
| `routing.ts` | `classifyPath`, `ModelBinding`, `createRoutingTable` → `resolve` / `resolveModelLess` / `listModels` |

## Semantics

- **Resolve** (spec §5.2): top-down first-match-wins over `models`,
  case-insensitive glob; `$MODEL` passes the logical name through;
  no match → `RoutingError` 400 `no binding for model X`.
- **Inbound classification**: `/v1/messages` → anthropic-messages,
  `/v1/chat/completions` → openai-chat, `/v1/responses` → 501 (deferred, §17),
  `/v1/models` → locally synthesized via `listModels()`, else 404.
- **Model-less** (embeddings, count_tokens; §17): routed to `defaultProvider`
  (raw passthrough, no formats) or `RoutingError` 501.
- **Plugin merge** (spec §5.3): position = first declaration in the effective
  assembly; config = most specific layer; `{ name: false }` disables at its
  layer and a later re-declaration re-enables by appending at the end.
- **baseUrl** (spec §5.1): everything before the version path — the format
  owns `/v1/...` (see `ENDPOINT_PATHS` in plugin-api). Trailing `/v1` is
  rejected at load; `endpointUrl` collapses accidental `/v1/v1` doubling.
