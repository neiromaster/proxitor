---
"proxitor": minor
---

Add OpenRouter API base URL prompt to setup wizard. The wizard now asks for `openrouterBaseUrl` (default `https://openrouter.ai/api/v1`), useful for self-hosted or custom OpenRouter endpoints. The field is omitted from config when the default is used.