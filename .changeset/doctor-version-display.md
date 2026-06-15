---
"proxitor": patch
---

Show the app version in `doctor`'s version check

The `version` check stored its value under `current`, which the text report formatter ignores (it reads `value`), so the report printed `✓ version` with no number. The version now lives on `value`, matching every other check, so the line reads e.g. `✓ version — 0.9.0-beta.9`.
