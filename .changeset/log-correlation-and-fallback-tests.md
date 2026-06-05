---
"@proxitor/proxitor": minor
---

Add request correlation ID to proxy logs and shorten upstream URL display

- Each proxied request now gets a short 8-char hex ID (`[abcd1234]`) that appears in both the request (`→`) and response (`←`) log lines, making it easy to correlate concurrent requests
- Strip `https://` from the upstream URL in request logs — the protocol is always the same, and the path is the important part
- Add 29 comprehensive tests for `OpenRouterDataClient` fallback behavior (HTTP errors, network errors with retry, invalid response format, skipFallback mode, onFallback callback)