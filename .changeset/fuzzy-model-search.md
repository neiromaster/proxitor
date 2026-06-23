---
"proxitor": minor
---

The model picker in `proxitor config browse` and `Add model override` is now fuzzy. Type abbreviations and out-of-order fragments — `claudops` → `anthropic/claude-opus`, `gpt4o` → `openai/gpt-4o`, `sonet` → `…/claude-…-sonnet` — and results rank by relevance, with consecutive and word-boundary matches (`/`, `-`, `_`, `.`, space) preferred over scattered interior ones. Previously the search required an exact, ordered substring, so typos and acronyms found nothing. No new dependencies; no config change required.
