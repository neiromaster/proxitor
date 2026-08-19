---
'@proxitor/plugin-api': minor
---

Add `ENDPOINT_PATHS` contract: the endpoint path each wire format owns (anthropic-messages `/v1/messages`, openai-chat `/v1/chat/completions`). Consumed by domain routing for baseUrl validation and upstream URL construction.
