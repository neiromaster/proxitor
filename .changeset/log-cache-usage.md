---
"proxitor": minor
---

Log cache token usage from upstream responses (JSON and SSE)

Both non-streaming and streaming responses now log cache hit/miss
tokens so you can verify prompt caching without inspecting raw API
responses. Supports Anthropic (`cache_read_input_tokens` /
`cache_creation_input_tokens`) and OpenAI/OpenRouter
(`prompt_tokens_details.cached_tokens` / `cache_write_tokens`)
formats.

Also updated the app attribution header from `X-Title` to
`X-OpenRouter-Title` (the current recommended name).