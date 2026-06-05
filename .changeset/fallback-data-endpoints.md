---
"proxitor": patch
---

Add automatic fallback to OpenRouter for data endpoints (`/providers`, `/models`, `/models/*/endpoints`) when a custom API URL doesn't support them. Add `openrouterDataUrl` config option for explicit control over the primary data source. Move cache to `~/.cache/proxitor/` (XDG-compliant).