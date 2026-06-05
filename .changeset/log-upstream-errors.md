---
"proxitor": patch
---

Log upstream error body (message, provider, raw) on 4xx/5xx responses

Previously, error responses from upstream (400, 429, 500, etc.) were
logged as status code and time only — the cause was invisible in logs.
Now the proxy reads the error body and logs the extracted detail:

- `error.code` and `error.message` from OpenRouter-style responses
- `error.metadata.provider_name` — which provider caused the error
- `error.metadata.raw` — the original provider error (most specific cause)

4xx errors log at `warn` level, 5xx at `error` level.
The full error body is still passed through to the client unchanged.