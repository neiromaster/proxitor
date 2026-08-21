import { mergePluginLayers } from '../domain/index.js';
import type { ProxyConfig } from './config-schema.js';
import type { PluginManager } from './plugin-manager.js';

/**
 * D-M5a-4/D7: activate every route at load — reservedKeys↔wireFormat mismatches
 * and plugin config errors fail startup instead of surfacing as request-time 500s.
 * Mirrors the table-build dry-run loops in createRoutingTable.
 */
export function validateActivation(config: ProxyConfig, manager: PluginManager): void {
  for (const binding of config.models) {
    const provider = config.providers[binding.provider];
    if (provider === undefined) continue; // createRoutingTable already failed loudly
    manager.activate(
      mergePluginLayers(config.plugins, provider.plugins, binding.plugins),
      provider.wireFormat,
    );
  }
  if (config.defaultProvider !== undefined) {
    const provider = config.providers[config.defaultProvider];
    if (provider !== undefined) {
      manager.activate(
        mergePluginLayers(config.plugins, provider.plugins),
        provider.wireFormat,
      );
    }
  }
}
