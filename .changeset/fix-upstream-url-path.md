---
"proxitor": patch
---

Fix upstream URL construction — buildUpstreamUrl now correctly parses request URL via new URL() instead of raw string concatenation, fixing proxy routing for all endpoints
