# Built-in plugins

Four `ProxyPlugin` factories over the Canonical IR. Bundle via
`createBuiltInPluginRegistry()` (name → plugin) and hand the map to
`createPluginManager({ plugins })` in the composition root. Each factory call
creates a fresh instance; `session-id` keeps per-instance state and hands it
over hot-reloads via `exportState`/`restoreState`.

Recommended order in a plugin list (request hooks run in list order):

```yaml
plugins:
  - normalize-volatile-system
  - cache-control: { ttl: 1h }
  - session-id
  - openrouter-routing   # openai-chat providers only
```

## normalize-volatile-system

No config. Rewrites Claude Code's volatile hashes in every system block to
constants (`cch=<hex>` → `cch=00000`, `cc_version=<semver>.<hex>` →
`cc_version=<semver>.0`) — they drift every turn and break prefix caching on
non-Anthropic providers.

## cache-control

```yaml
cache-control: { cacheControl: auto, ttl: 1h, rewriteBlockTtl: auto }
```

- `cacheControl` (`auto` | `always` | `skip`, default `auto`): injection knob.
  `auto` injects only when the request already carries a cache breakpoint
  (openai-origin requests never do, so they stay untouched — round-trip
  identity preserved). Target: last system block → else last block of the last
  content-bearing message → else last tool; existing marks are never
  overwritten.
- `ttl` (`5m` | `1h` | `omit`, default absent = passthrough): TTL stamped on
  injected marks and (with `rewriteBlockTtl: auto`) normalized onto every
  existing breakpoint, including nested tool_result content. `omit` strips TTLs.
- `rewriteBlockTtl` (`auto` | `skip`, default `auto`): disable TTL rewriting.

## session-id

```yaml
session-id: { mode: auto }
```

`mode: skip` disables. Derives a stable id: sha256(logical model + system
texts + first user message content signature) — the first user message is
immutable across turns of one conversation, so the id is stable. Writes it as
`x-session-id` through `ir.outboundHeaders` (sticky routing; OpenRouter reads
it). Requests without any system/user content share a per-instance fallback
uuid that survives hot-reload via state handoff.

## openrouter-routing

```yaml
openrouter-routing: { only: [anthropic], order: [anthropic] }
```

OpenRouter provider routing hints — full field set: `only`, `order`, `ignore`,
`quantizations` (string or array), `allowFallbacks`, `sort`, `maxPrice`,
`requireParameters`, `dataCollection`, `zdr`, `enforceDistillableText`,
`preferredMinThroughput`, `preferredMaxLatency`. Maps to the wire `provider`
object (snake_case; `order` implies `allow_fallbacks: true` unless set) via the
reserved extension key `extensions['openai-chat']['$proxitor.provider']`, which
the openai-chat encoder applies after the client passthrough merge. Hard-gated
to `openai-chat` providers by its `reservedKeys` declaration — configuring it
on another wire format is a config error (500 `plugin_config_error` until M5
moves the check to load time).
