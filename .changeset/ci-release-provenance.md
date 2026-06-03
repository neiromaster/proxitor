---
"proxitor": patch
---

Split CI/release workflows, add npm provenance, bump Node to 22+

- Separate CI and Release GitHub Actions workflows
- npm provenance via Trusted Publishing (OIDC)
- Update GitHub Actions to v6
- Drop EOL Node 20, test on Node 22 and 24
- Fix tsdown dts option: resolve → resolver: 'tsc'
