import type { LoggerPort } from '@proxitor/plugin-api';
import { mergePluginLayers } from '../domain/index.js';
import type { ProxyConfig } from './config-schema.js';
import {
  type PluginActivationSkip,
  type PluginManager,
  pluginFormatSkipWarning,
} from './plugin-manager.js';

/**
 * D-M5a-4/D7: activate every route at load — unknown plugin names and plugin
 * config errors fail startup instead of surfacing as request-time 500s.
 * B5.2: format-incompatible entries are skipped with a warn per (plugin,
 * route) pair — the docs promise such a plugin "does not affect" requests in
 * other formats. Mirrors the table-build dry-run loops in createRoutingTable.
 */
export function validateActivation(
  config: ProxyConfig,
  manager: PluginManager,
  logger?: LoggerPort,
): void {
  const onSkipFor = (route: string) => (skip: PluginActivationSkip) => {
    logger?.warn(pluginFormatSkipWarning(skip), {
      route,
      plugin: skip.plugin,
      wireFormat: skip.wireFormat,
    });
  };
  for (const binding of config.models) {
    const provider = config.providers[binding.provider];
    if (provider === undefined) continue; // createRoutingTable already failed loudly
    manager.activate(
      mergePluginLayers(config.plugins, provider.plugins, binding.plugins),
      provider.wireFormat,
      onSkipFor(`${binding.match} → ${binding.provider}`),
    );
  }
  if (config.defaultProvider !== undefined) {
    const provider = config.providers[config.defaultProvider];
    if (provider !== undefined) {
      manager.activate(
        mergePluginLayers(config.plugins, provider.plugins),
        provider.wireFormat,
        onSkipFor(`defaultProvider ${config.defaultProvider}`),
      );
    }
  }
}
