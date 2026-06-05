---
"proxitor": patch
---

Refactor configuration to use Zod `.default()` as the single source of truth. All default values now derive from the schema, eliminating duplicated constants across modules. Config validation now runs through Zod on the final merged result, and the wizard uses `readConfigFile` instead of manual YAML parsing.