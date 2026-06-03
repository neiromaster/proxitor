---
"proxitor": minor
---

XDG config directory support and --no-config CLI flag

- Resolve config from XDG_CONFIG_HOME (~/.config/proxitor)
- Support --no-config flag to skip config file loading
- Priority: --config flag > current dir > XDG directory
