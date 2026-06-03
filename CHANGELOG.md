# Changelog

## 0.2.1

### Patch Changes

- 224c205: Fix upstream URL construction — buildUpstreamUrl now correctly parses request URL via new URL() instead of raw string concatenation, fixing proxy routing for all endpoints

## 0.2.0

### Minor Changes

- ca26014: Add Hono-based proxy with provider routing and SSE streaming

  Implements the core proxy server using Hono with:

  - Provider routing (OpenRouter, OpenAI, Anthropic)
  - SSE streaming support for real-time responses
  - Per-model config overrides with provider and header routing
  - Parse error cause restoration in injectProvider

- ca26014: Full OpenRouter provider support and runtime improvements

  - Complete OpenRouter provider field support
  - Graceful shutdown handling
  - dotenv integration for environment variables
  - Empty array filter for clean request payloads

- ca26014: XDG config directory support and --no-config CLI flag

  - Resolve config from XDG_CONFIG_HOME (~/.config/proxitor)
  - Support --no-config flag to skip config file loading
  - Priority: --config flag > current dir > XDG directory

### Patch Changes

- ca26014: Split CI/release workflows, add npm provenance, bump Node to 22+

  - Separate CI and Release GitHub Actions workflows
  - npm provenance via Trusted Publishing (OIDC)
  - Update GitHub Actions to v6
  - Drop EOL Node 20, test on Node 22 and 24
  - Fix tsdown dts option: resolve → resolver: 'tsc'

## 0.1.0

Initial release.
