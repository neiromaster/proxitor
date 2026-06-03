---
"proxitor": minor
---

Add Hono-based proxy with provider routing and SSE streaming

Implements the core proxy server using Hono with:
- Provider routing (OpenRouter, OpenAI, Anthropic)
- SSE streaming support for real-time responses
- Per-model config overrides with provider and header routing
- Parse error cause restoration in injectProvider
