---
"proxitor": minor
---

Show base URL and auth type in the setup wizard preview

The wizard's Preview note omitted `openrouterBaseUrl` and `authType` when they matched the defaults, so users couldn't see two values they had just chosen on steps 4–5. The preview now always shows a two-line header (Base URL + auth type, friendly label) above the YAML. The saved config file stays clean — defaults are still omitted. Auth option metadata is extracted into a shared `AUTH_OPTIONS` constant (DRY) reused by the auth prompt and the preview.
