---
"proxitor": minor
---

Add zod-based runtime config validation

Config files are now validated at load time with clear error messages:
- Unknown fields (typos like `porrt`) are caught and reported
- Invalid values (negative ports, wrong enums, non-URL base URLs, negative prices) are rejected
- Malformed YAML/JSON produces `ConfigParseError` with file path
- Schema violations produce `ConfigValidationError` with field paths

New exports: `ConfigParseError`, `ConfigValidationError`
Added `zod` as a runtime dependency.
