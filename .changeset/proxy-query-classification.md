---
"proxitor": patch
---

Requests with query parameters (e.g. `?stream=true`) are now classified to the correct endpoint instead of falling back to `other`, restoring session-id fingerprinting and `cache_control` injection for query-bearing paths.
