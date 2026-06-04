---
"proxitor": minor
---

Migrate CLI from `cac` to `cmd-ts` — type-safe args, native subcommands

- Replaced `cac` with `cmd-ts` for type-driven CLI parsing
- Added `start` and `config` as explicit subcommands (`proxitor start`, `proxitor config menu`)
- `proxitor` without arguments still starts the proxy (backward compatible)
- `--help` now shows both `start` and `config` subcommands
- Config subcommands (`add`, `edit`, `remove`, `list`, `browse`, `validate`, `menu`) are routed natively
- Provider lists are now sorted alphabetically
- Model selection hints show input, output, and cache pricing
- Removed `/1M` suffix from price formatting
- `--help` no longer triggers dotenv injection
