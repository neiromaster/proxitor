---
"proxitor": patch
---

The `normalizeVolatileSystem` flag (shipped in 0.10.0 as a global or per-model
YAML option) is now settable per-model from the interactive wizard:

- **`proxitor config add` / `edit`** — the add and edit override flows prompt
  for `normalizeVolatileSystem` (On / Off / Reset-inherit), mirroring the
  existing session/cache collectors, and show it in the proposed-override
  preview and current-config output.
- The global `normalizeVolatileSystem` command now shares one On/Off/Reset
  prompt primitive with the per-model flow.
- `proxitor.config.example.yaml` documents the per-model form.
