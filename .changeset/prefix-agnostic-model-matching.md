---
"proxitor": minor
---

Model override keys now match with or without the vendor prefix: a bare `kimi-k2.6` resolves to the `moonshotai/kimi-k2.6` override, so unprefixed model names pick up the right config. Prefix wildcards still require an explicit `*` (`moonshotai/kimi-k2.6-20260420` matches `moonshotai/kimi-k2.6*`, not the bare key), so `gpt-4` never captures `gpt-4o`, and a vendor-prefixed key never applies to another vendor's same-slug name (`openai/gpt-4o` no longer captures `azure/gpt-4o`). The incoming model name is forwarded upstream unchanged.

When several override keys share a model name across vendors, `proxitor` detects the collision — warns once at startup and only re-warns when it changes, reports it in `proxitor doctor`, and resolves a bare name to a single key (a bare key if present, otherwise the first-declared), naming it in the warning. `--verbose` additionally logs which override matched each request.
