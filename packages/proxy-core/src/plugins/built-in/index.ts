import type { ProxyPlugin } from '@proxitor/plugin-api';
import { createCacheControlPlugin } from './cache-control.js';
import { createNormalizeVolatileSystemPlugin } from './normalize-volatile-system.js';
import { createOpenRouterRoutingPlugin } from './openrouter-routing.js';
import { createSessionIdPlugin } from './session-id.js';

export type { CacheControlPluginConfig } from './cache-control.js';
export { createCacheControlPlugin } from './cache-control.js';
export {
  createNormalizeVolatileSystemPlugin,
  normalizeVolatileText,
} from './normalize-volatile-system.js';
export type { OpenRouterRoutingConfig } from './openrouter-routing.js';
export {
  buildProviderRouting,
  createOpenRouterRoutingPlugin,
} from './openrouter-routing.js';
export type { SessionIdPluginConfig, SessionIdState } from './session-id.js';
export { createSessionIdPlugin, deriveSessionId } from './session-id.js';

/** Registry of built-in plugins for the composition root (spec §3.1). */
export function createBuiltInPluginRegistry(): ReadonlyMap<string, ProxyPlugin> {
  const plugins = [
    createNormalizeVolatileSystemPlugin(),
    createCacheControlPlugin(),
    createSessionIdPlugin(),
    createOpenRouterRoutingPlugin(),
  ];
  return new Map(plugins.map(plugin => [plugin.name, plugin]));
}
