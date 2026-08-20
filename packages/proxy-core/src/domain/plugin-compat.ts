import type { ProxyPlugin, WireFormat } from '@proxitor/plugin-api';
import { RoutingConfigError } from './error.js';

/**
 * Spec §4.3: a plugin declaring reservedKeys for format F is only valid on
 * routes whose outbound wire format is F. Config-time (load-time) check per
 * spec; until M5 wires load-time activation it runs per activation (D7:
 * request-time 500 plugin_config_error).
 */
export function assertPluginFormatCompatible(
  plugin: Pick<ProxyPlugin, 'reservedKeys'>,
  outboundFormat: WireFormat,
  pluginName: string,
): void {
  const declared = Object.keys(plugin.reservedKeys ?? {}) as WireFormat[];
  // If the plugin declares formats, the outbound format must be one of them
  if (declared.length > 0 && !declared.includes(outboundFormat)) {
    throw new RoutingConfigError(
      `plugin "${pluginName}" writes reserved keys for format(s) ${declared.join(', ')} ` +
        `but the route's outbound wire format is ${outboundFormat}`,
    );
  }
}
