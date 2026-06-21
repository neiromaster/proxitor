# Renders docs/assets/proxitor-add.gif — adding a model override via the config menu.
#
# One-time setup (run from the repo root, then `vhs docs/assets/proxitor-add.tape`):
#   rm -rf /tmp/proxitor-demo /tmp/proxitor-bin
#   mkdir -p /tmp/proxitor-demo/xdg /tmp/proxitor-bin
#   printf '#!/bin/sh\nexec node "%s/dist/cli.mjs" "$@"\n' "$PWD" > /tmp/proxitor-bin/proxitor
#   chmod +x /tmp/proxitor-bin/proxitor
#   printf 'openrouterKey: sk-or-demo-not-a-real-key-xxxxxxxx\nhost: 127.0.0.1\nport: 8828\n' \
#     > /tmp/proxitor-demo/proxitor.config.yaml
# Model/provider data comes from OpenRouter's public endpoints (no key needed).

Output docs/assets/proxitor-add.gif

Require vhs

Set Theme "Dracula"
Set FontSize 15
Set Width 1200
Set Height 780
Set Padding 20
Set TypingSpeed 45ms

Hide
Type "export PATH=/tmp/proxitor-bin:$PATH XDG_CONFIG_HOME=/tmp/proxitor-demo/xdg && cd /tmp/proxitor-demo && clear"
Enter
Sleep 700ms
Show

Type "proxitor config"
Enter
Sleep 1500ms

# move to "Add model override" (3 selects down from "Show current config")
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 450ms
Enter
Sleep 1000ms

# spinner: loading models from OpenRouter (network)
Sleep 4500ms

# autocomplete: type "deepseek", Down steps into the list, Enter selects the first match
Type "deepseek"
Sleep 1400ms
Down
Sleep 450ms
Enter
Sleep 1900ms

# routing mode: "Use specific providers only" (default)
Enter
Sleep 1600ms

# spinner: fetching providers for this model (network)
Sleep 3500ms

# multiselect providers: toggle two ON, then confirm
Sleep 500ms
Space
Sleep 450ms
Down
Sleep 350ms
Space
Sleep 450ms
Enter
Sleep 1300ms

# session routing for this model? (confirm, default No)
Enter
Sleep 900ms

# cache control for this model? (confirm, default No)
Enter
Sleep 1300ms

# normalizeVolatileSystem for this model? (confirm, default No)
Enter
Sleep 900ms

# What next? (select, default "Save to config")
Enter
Sleep 1700ms

# back at the menu — scroll down to Exit (9 selects)
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 230ms
Down
Sleep 450ms

Enter
Sleep 1600ms
