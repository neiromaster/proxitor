import type { CanonicalRequest, ProxyPlugin } from '@proxitor/plugin-api';
import { definePlugin } from '@proxitor/plugin-api';

/**
 * Neutralize Claude Code's per-request volatile hashes in system blocks: they
 * drift every turn and break prefix caching for non-Anthropic providers.
 *  - `cch=<hex>` per-turn hash → constant
 *  - `cc_version=<semver>.<hex>` → build hash zeroed, readable semver kept
 * Port of legacy src/proxy/middleware/normalize-volatile-system.ts (patterns verbatim).
 */
const CCH_PATTERN = /cch=[0-9a-f]+/g;
const CCH_REPLACEMENT = 'cch=00000';
const CC_VERSION_PATTERN = /cc_version=(\d+\.\d+\.\d+)\.[0-9a-f]+/g;
const CC_VERSION_REPLACEMENT = 'cc_version=$1.0';

export function normalizeVolatileText(text: string): string {
  return text
    .replace(CCH_PATTERN, CCH_REPLACEMENT)
    .replace(CC_VERSION_PATTERN, CC_VERSION_REPLACEMENT);
}

export function createNormalizeVolatileSystemPlugin(): ProxyPlugin {
  return definePlugin({
    name: 'normalize-volatile-system',
    onRequest(_ctx, req: CanonicalRequest) {
      let changed = false;
      const system = req.system.map(block => {
        const text = normalizeVolatileText(block.text);
        if (text === block.text) return block;
        changed = true;
        return { ...block, text };
      });
      return changed ? { ...req, system } : req;
    },
  });
}
