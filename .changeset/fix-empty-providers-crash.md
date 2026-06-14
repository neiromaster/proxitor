---
"proxitor": patch
---

Fix crash in `config add`/`edit` when a model has no provider endpoints

Selecting a model without published endpoint data (e.g. OpenRouter aliases like `~anthropic/claude-sonnet-latest`) yielded zero providers and crashed the provider multiselect with "Cannot read properties of undefined (reading 'disabled')". `selectProvidersByMode` now bails with a warning instead of reaching the multiselect with an empty list.
