import { RoutingConfigError } from './error.js';

/**
 * Config form of a plugin declaration (spec §5.3): bare name, `{ name: config }`,
 * or `{ name: false }` to disable an inherited plugin.
 */
export type PluginListEntry = string | Readonly<Record<string, unknown>>;

/** A plugin after 3-layer merge: effective position + winning config. */
export type EffectivePlugin = {
  readonly name: string;
  readonly config?: unknown;
};

/**
 * Merge plugin layers general → specific (global, provider, binding; spec §5.3).
 * Position = first declaration in the effective assembly; config = most
 * specific; `{ name: false }` removes at its layer and a later re-declaration
 * re-enables by appending at the end.
 */
export function mergePluginLayers(
  ...layers: ReadonlyArray<readonly PluginListEntry[] | undefined>
): EffectivePlugin[] {
  const effective: EffectivePlugin[] = [];
  for (const layer of layers) {
    if (layer === undefined) continue;
    for (const entry of layer) {
      applyEntry(effective, entry);
    }
  }
  return effective;
}

function applyEntry(effective: EffectivePlugin[], entry: PluginListEntry): void {
  if (typeof entry === 'string') {
    if (!effective.some(plugin => plugin.name === entry)) {
      effective.push({ name: entry });
    }
    return;
  }

  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new RoutingConfigError(
      `plugin list entry must have exactly one key, got ${keys.length}: ${JSON.stringify(entry)}`,
    );
  }
  const name = keys[0] as string;
  const config: unknown = entry[name];

  if (config === false) {
    const index = effective.findIndex(plugin => plugin.name === name);
    if (index !== -1) {
      effective.splice(index, 1);
    }
    return;
  }

  const index = effective.findIndex(plugin => plugin.name === name);
  if (index === -1) {
    effective.push(config === undefined ? { name } : { name, config });
    return;
  }
  effective[index] = config === undefined ? { name } : { name, config };
}
