# Renders docs/assets/proxitor-wizard.gif — the interactive setup wizard.
#
# One-time setup (run from the repo root, then `vhs docs/assets/proxitor-wizard.tape`):
#   rm -rf /tmp/proxitor-demo /tmp/proxitor-bin
#   mkdir -p /tmp/proxitor-demo/xdg /tmp/proxitor-bin
#   printf '#!/bin/sh\nexec node "%s/dist/cli.mjs" "$@"\n' "$PWD" > /tmp/proxitor-bin/proxitor
#   chmod +x /tmp/proxitor-bin/proxitor
# The wizard creates the config live with a FAKE key; an isolated XDG dir keeps
# your real config untouched.

Output docs/assets/proxitor-wizard.gif

Require vhs

Set Theme "Dracula"
Set FontSize 15
Set Width 1200
Set Height 680
Set Padding 20
Set TypingSpeed 45ms

Hide
Type "export PATH=/tmp/proxitor-bin:$PATH XDG_CONFIG_HOME=/tmp/proxitor-demo/xdg && cd /tmp/proxitor-demo && rm -f proxitor.config.yaml && clear"
Enter
Sleep 700ms
Show

Type "proxitor config wizard"
Enter
Sleep 1500ms

# Step 1/6 — API key (text)
Type "sk-or-demo-not-a-real-key-xxxxxxxx"
Enter
Sleep 1600ms

# Step 2/6 — port (prefilled 8828) -> keep
Enter
Sleep 900ms

# Step 3/6 — listen address (select, 0.0.0.0) -> keep
Enter
Sleep 900ms

# Step 4/6 — base URL (empty = default) -> keep
Enter
Sleep 900ms

# Step 5/6 — auth type (select, bearer) -> keep
Enter
Sleep 2500ms

# Step 6/6 — save location (select, local) -> keep
Enter
Sleep 1300ms

# confirm save (yes) -> keep
Enter
Sleep 1800ms
