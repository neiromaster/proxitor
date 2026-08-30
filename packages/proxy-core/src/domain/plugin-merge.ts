import { RoutingConfigError } from './error.js';

/**
 * Config form of a plugin declaration (spec §5.3): bare name, `{ name: config }`,
 * `{ name: false }` to disable an inherited plugin, or the documented bulk form
 * `{ disable: [name, ...] }` to disable several inherited plugins at once.
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

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

function appendIfAbsent(effective: EffectivePlugin[], name: string): void {
  if (!effective.some(plugin => plugin.name === name)) {
    effective.push({ name });
  }
}

/** Find-and-splice removal shared by `{ name: false }` and `{ disable: [names] }`. */
function removeNamed(effective: EffectivePlugin[], name: string): void {
  const index = effective.findIndex(plugin => plugin.name === name);
  if (index !== -1) {
    effective.splice(index, 1);
  }
}

function upsertConfig(effective: EffectivePlugin[], name: string, config: unknown): void {
  const next: EffectivePlugin = config === undefined ? { name } : { name, config };
  const index = effective.findIndex(plugin => plugin.name === name);
  if (index === -1) {
    effective.push(next);
    return;
  }
  effective[index] = next;
}

function applyEntry(effective: EffectivePlugin[], entry: PluginListEntry): void {
  if (typeof entry === 'string') {
    appendIfAbsent(effective, entry);
    return;
  }

  // F4: Reject arrays and any non-plain-object entries
  if (Array.isArray(entry)) {
    throw new RoutingConfigError(
      'plugin list entry must be a string or a plain object, got an array',
    );
  }

  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new RoutingConfigError(
      `plugin list entry must have exactly one key, got ${keys.length}: ${JSON.stringify(entry)}`,
    );
  }
  const name = keys[0];
  if (name === undefined) {
    // Total-code guard: keys.length === 1 was just enforced above.
    throw new RoutingConfigError('plugin list entry must have exactly one key');
  }
  const config: unknown = entry[name];

  if (config === false) {
    removeNamed(effective, name);
    return;
  }

  // B5.1: the documented bulk-disable form `{ disable: [names] }` removes each
  // named plugin with the same find-and-splice as `{ name: false }`. Any other
  // `disable` shape falls through to the one-key-record semantics below (a
  // plugin literally named "disable", rejected as unknown at activation).
  if (name === 'disable' && isStringArray(config)) {
    for (const pluginName of config) {
      removeNamed(effective, pluginName);
    }
    return;
  }

  upsertConfig(effective, name, config);
}
