---
"proxitor": minor
---

Add interactive config manager (`proxitor config`) with @clack/prompts

New `proxitor config` command with subcommands for managing model overrides
through an interactive CLI instead of editing YAML by hand:

- `config add` — search models with type-ahead autocomplete, fetch available
  providers from OpenRouter, select routing mode (only/order/ignore), and
  save to config with YAML comment preservation
- `config edit` — modify provider routing for existing overrides
- `config remove` — delete one or more overrides with confirmation
- `config list` — display all current overrides
- `config browse` — explore models with pricing, context length, latency,
  and throughput info; option to configure routing directly
- `config validate` — check config file against Zod schema

The interface uses live OpenRouter API data (models, endpoints, providers)
with file-based caching. Model search uses @clack/prompts autocomplete with
a dynamic options getter. Config writes preserve YAML comments via the `yaml`
package.
