---
'@proxitor/proxy-core': minor
---

Domain routing (M3): provider registry validation (baseUrl `/v1` rules, anthropic-version requirement, auth shapes), glob model table with top-down first-match-wins and `$MODEL` passthrough, 3-layer plugin merge with disable/re-enable semantics, inbound path classification (`/v1/responses` → 501), and `/v1/models` synthesis from the routing table.
