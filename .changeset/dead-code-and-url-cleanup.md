---
"proxitor": minor
---

Remove dead code and simplify URL routing

- **Breaking**: `openrouterBaseUrl` default changed from `https://openrouter.ai/api/v1` to `https://openrouter.ai/api` — incoming request paths (e.g. `/v1/chat/completions`) are now forwarded as-is instead of stripping `/v1`
- **Breaking**: removed `extractModel`, `InjectionParams`, and `tryParseBody` from public API (unused after middleware refactor)
- **Breaking**: removed `shouldInject` and `toUpstreamPath` from `src/proxy/paths.ts`
- Added runtime warning when `openrouterBaseUrl` or `openrouterDataUrl` ends with `/v1` — helps catch configs from previous versions that would produce doubled paths like `/v1/v1/chat/completions`
- Added `classifyEndpoint()` for centralized endpoint type detection, replacing scattered string comparisons across middleware
- Added `tsc --noEmit` to pre-commit hook alongside biome
- Added `config: ProxyConfig` to `ProxyVariables` context type (removed unsafe `as never` casts)
- Data client paths updated to `/v1/providers`, `/v1/models`, `/v1/models/{author}/{slug}/endpoints`
