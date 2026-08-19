---
'@proxitor/plugin-api': minor
---

Add optional `extensions` passthrough to `message_delta` stream events, carrying raw wire stop-reason provenance (e.g. openai `finish_reason`) per spec §4.2. Package `exports` now resolve to source inside the workspace; `publishConfig` swaps them to `dist` at publish time.
