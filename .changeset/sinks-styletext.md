---
"proxitor": patch
---

Observability sink colors now use Node's built-in `util.styleText`.

Replaces the hand-rolled `\x1b[..m` / `\x1b[0m` wrappers with `styleText` from
`node:util` (stable on Node 20.12+, already in the `>=22` engine range). Colors
render identically; the only observable difference is the trailing reset escape
changing from `\x1b[0m` to `styleText`'s per-format reset (`\x1b[39m` / `\x1b[22m`),
which matters only to byte-level log scrapers. No new dependency added.
