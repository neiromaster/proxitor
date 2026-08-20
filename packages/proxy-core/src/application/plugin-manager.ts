import type { LoggerPort, ProxyPlugin, WireFormat } from '@proxitor/plugin-api';
import type { EffectivePlugin } from '../domain/index.js';
import { assertPluginFormatCompatible, RoutingConfigError } from '../domain/index.js';

/** A plugin resolved for one route: instance + validated config (spec §7). */
export type ActivePlugin = {
  readonly name: string;
  readonly plugin: ProxyPlugin;
  readonly config: unknown;
};

export type PluginManager = {
  activate(
    effective: readonly EffectivePlugin[],
    outboundFormat: WireFormat,
  ): ActivePlugin[];
  snapshot(): Readonly<Record<string, unknown>>;
  restore(states: Readonly<Record<string, unknown>>): void;
};

export type PluginManagerOptions = {
  /** Registry of available plugin instances; composition root (M5) builds it. */
  readonly plugins: ReadonlyMap<string, ProxyPlugin>;
  readonly logger: LoggerPort;
};

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  const { plugins, logger } = options;

  /**
   * Resolve effective plugins for one route. `outboundFormat` enforces the
   * reservedKeys↔wireFormat contract (spec §4.3) — a mismatch is a config
   * error, never a silent no-op.
   */
  const activate = (
    effective: readonly EffectivePlugin[],
    outboundFormat: WireFormat,
  ): ActivePlugin[] => {
    const active: ActivePlugin[] = [];
    for (const entry of effective) {
      const plugin = plugins.get(entry.name);
      if (plugin === undefined) {
        throw new RoutingConfigError(
          `unknown plugin "${entry.name}" (registered: ${[...plugins.keys()].join(', ') || 'none'})`,
        );
      }
      assertPluginFormatCompatible(plugin, outboundFormat, entry.name);
      let config: unknown = entry.config;
      if (plugin.validateConfig !== undefined) {
        try {
          config = plugin.validateConfig(entry.config);
        } catch (error) {
          throw new RoutingConfigError(
            `plugin "${entry.name}" rejected its config: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
      active.push({ name: entry.name, plugin, config });
    }
    return active;
  };

  const snapshot = (): Readonly<Record<string, unknown>> => {
    const states: Record<string, unknown> = {};
    for (const [name, plugin] of plugins) {
      if (plugin.exportState === undefined) {
        continue;
      }
      try {
        states[name] = plugin.exportState();
      } catch (error) {
        logger.warn('plugin state export failed', {
          plugin: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return states;
  };

  const restore = (states: Readonly<Record<string, unknown>>): void => {
    for (const [name, state] of Object.entries(states)) {
      const plugin = plugins.get(name);
      if (plugin?.restoreState === undefined) {
        continue;
      }
      try {
        plugin.restoreState(state);
      } catch (error) {
        logger.warn('plugin state restore failed', {
          plugin: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  return { activate, snapshot, restore };
}
