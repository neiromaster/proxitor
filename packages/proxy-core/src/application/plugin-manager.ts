import {
  type LoggerPort,
  type ProxyPlugin,
  WIRE_FORMATS,
  type WireFormat,
} from '@proxitor/plugin-api';
import type { EffectivePlugin } from '../domain/index.js';
import { RoutingConfigError } from '../domain/index.js';

/** A plugin resolved for one route: instance + validated config (spec §7). */
export type ActivePlugin = {
  readonly name: string;
  readonly plugin: ProxyPlugin;
  readonly config: unknown;
};

/** A plugin skipped at activation: its reservedKeys don't cover the wire format (B5.2). */
export type PluginActivationSkip = {
  readonly plugin: string;
  readonly wireFormat: WireFormat;
};

/** Shared warn text so load-time and request-time skips read identically. */
export const pluginFormatSkipWarning = (skip: PluginActivationSkip): string =>
  `plugin "${skip.plugin}" does not support wire format ${skip.wireFormat}; skipped for this route`;

export type PluginManager = {
  activate(
    effective: readonly EffectivePlugin[],
    outboundFormat: WireFormat,
    /** B5.2: called once per format-incompatible entry instead of throwing. */
    onSkip?: (skip: PluginActivationSkip) => void,
  ): ActivePlugin[];
};

export type PluginManagerOptions = {
  /** Registry of available plugin instances; composition root (M5) builds it. */
  readonly plugins: ReadonlyMap<string, ProxyPlugin>;
  readonly logger: LoggerPort;
};

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  const { plugins } = options;

  /**
   * Resolve effective plugins for one route. `outboundFormat` enforces the
   * reservedKeys↔wireFormat contract (spec §4.3): a plugin whose reservedKeys
   * don't cover the route's format is skipped and reported through `onSkip`
   * (B5.2), while unknown plugin names and rejected configs still throw.
   */
  const activate = (
    effective: readonly EffectivePlugin[],
    outboundFormat: WireFormat,
    onSkip?: (skip: PluginActivationSkip) => void,
  ): ActivePlugin[] => {
    const active: ActivePlugin[] = [];
    for (const entry of effective) {
      const plugin = plugins.get(entry.name);
      if (plugin === undefined) {
        throw new RoutingConfigError(
          `unknown plugin "${entry.name}" (registered: ${[...plugins.keys()].join(', ') || 'none'})`,
        );
      }
      // B5.2: the plugin simply doesn't affect routes in other formats —
      // skipping mirrors the documented behavior instead of aborting startup.
      const declared = WIRE_FORMATS.filter(
        format => format in (plugin.reservedKeys ?? {}),
      );
      if (declared.length > 0 && !declared.includes(outboundFormat)) {
        onSkip?.({ plugin: entry.name, wireFormat: outboundFormat });
        continue;
      }
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

  return { activate };
}
