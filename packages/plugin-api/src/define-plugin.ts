import type { ZodType } from 'zod';
import type { ProxyPlugin } from './plugin.js';

type PluginWithoutValidate<TConfig> = Omit<ProxyPlugin<TConfig>, 'validateConfig'>;

/**
 * The only runtime helper in the package: attaches a zod-backed validateConfig
 * to a plugin (spec §7). Overload without a schema passes the plugin through.
 */
export function definePlugin<TConfig>(plugin: ProxyPlugin<TConfig>): ProxyPlugin<TConfig>;
export function definePlugin<TConfig>(
  schema: ZodType<TConfig>,
  plugin: PluginWithoutValidate<TConfig>,
): ProxyPlugin<TConfig>;
export function definePlugin<TConfig>(
  schemaOrPlugin: ZodType<TConfig> | ProxyPlugin<TConfig>,
  maybePlugin?: PluginWithoutValidate<TConfig>,
): ProxyPlugin<TConfig> {
  if (maybePlugin === undefined) {
    return schemaOrPlugin as ProxyPlugin<TConfig>;
  }
  const schema = schemaOrPlugin as ZodType<TConfig>;
  return {
    ...maybePlugin,
    validateConfig: (raw: unknown): TConfig => schema.parse(raw),
  };
}
