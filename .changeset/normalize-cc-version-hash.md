---
"proxitor": minor
---

`normalizeVolatileSystem` now also rewrites Claude Code's drifting `cc_version` build hash (preserving the readable semver), alongside the existing `cch` hash. Both churned bytes sit inside the cached prefix and invalidate it every turn for non-Anthropic providers (qwen/glm/etc.); collapsing `cc_version` keeps the cached prefix stable across turns. Opt-in — no config change required for existing users.
