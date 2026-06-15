---
"proxitor": patch
---

Make `doctor --timeout` optional so bare `proxitor doctor` works

`--timeout` was declared as a required cmd-ts option, so every documented invocation — `proxitor doctor`, `proxitor doctor --offline`, `proxitor doctor --json` — failed at parse time with "No value provided for --timeout". The option is now optional, matching the built-in `DEFAULT_TIMEOUT_MS` fallback the handler already assumed.
