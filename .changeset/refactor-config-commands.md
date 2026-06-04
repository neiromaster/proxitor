---
"proxitor": minor
---

Refactor config commands: extract shared modules, unify provider selection

- **Alphabetical sorting**: Provider lists are now sorted alphabetically
  in both pattern (prefix) and specific model flows (add and edit)
- **Unified provider selection**: The `order` routing mode now uses
  step-by-step sequential provider picking in both `config add` and
  `config edit`, not just `config add`
- **Module split**: Extracted `shared.ts` into three domain-focused
  modules — `config.ts` (YAML operations), `format.ts` (display
  formatting), `providers.ts` (fetching and interactive selection)
- **Complexity cleanup**: All cognitive complexity warnings resolved
  across `browse.ts`, `edit.ts`, and `list.ts`
