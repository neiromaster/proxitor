---
'@proxitor/proxy-core': minor
---

Built-in plugins for the v1 plugin gateway: `normalize-volatile-system` (Claude Code volatile-hash neutralization), `cache-control` (breakpoint TTL normalization + injection on the Canonical IR), `session-id` (content-fingerprint sticky routing via `x-session-id`), `openrouter-routing` (provider routing hints via the `$proxitor.provider` reserved key). Shipped as `createBuiltInPluginRegistry()` for the composition root. `PluginManager.activate` now enforces the reservedKeys↔wireFormat contract (request-time 500 `plugin_config_error` until load-time activation lands in M5).
