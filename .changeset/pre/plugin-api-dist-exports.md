---
'@proxitor/plugin-api': patch
---

Fix published package entry points: `exports` now resolves to the built `dist/` files. The previous manifest shipped `exports` pointing at `./src/index.ts`, which is not included in the published tarball, making the package unloadable for consumers. Workspace development now consumes the built output as well, so typecheck builds first (`typecheck:all` and CI both build before checking).
