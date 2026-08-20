import { ENDPOINT_PATHS, type WireFormat } from '@proxitor/plugin-api';
import { RoutingConfigError, RoutingError } from './error.js';
import { globMatch } from './glob.js';
import {
  type EffectivePlugin,
  mergePluginLayers,
  type PluginListEntry,
} from './plugin-merge.js';
import { type ProviderConfig, validateProvider } from './provider.js';

/** Locally-synthesized model listing endpoint (spec §5.2). */
export const MODELS_PATH = '/v1/models';

/** One row of the model routing table (spec §5.2). */
export type ModelBinding = {
  /** Glob: `*` is the only wildcard; matched case-insensitively. */
  readonly match: string;
  readonly provider: string;
  /** Physical model id, or '$MODEL' to pass the logical name through. */
  readonly modelId: string;
  readonly plugins?: readonly PluginListEntry[];
};

/** Result of resolving a request to a provider (spec §5.2). */
export type RouteResolution = {
  readonly provider: ProviderConfig;
  readonly physicalModel: string | undefined;
  readonly inboundFormat: WireFormat | undefined;
  readonly outboundFormat: WireFormat;
  readonly plugins: readonly EffectivePlugin[];
};

/** Routing slice of the config (spec §6): providers + models + plugin layers. */
export type RoutingConfig = {
  readonly providers: Readonly<Record<string, ProviderConfig>>;
  readonly models: readonly ModelBinding[];
  readonly plugins?: readonly PluginListEntry[];
  readonly defaultProvider?: string;
};

export type RoutingTable = {
  resolve(logicalModel: string, path: string): RouteResolution;
  resolveModelLess(_path: string): RouteResolution;
  listModels(): string[];
};

/**
 * Classify an inbound path (spec §5.2): the two LLM endpoints map to their
 * wire formats, `/v1/models` returns its sentinel, `/v1/responses` is a 501
 * (format deferred, §17), anything else is a 404.
 */
export function classifyPath(path: string): WireFormat | typeof MODELS_PATH {
  if (path === ENDPOINT_PATHS['anthropic-messages']) {
    return 'anthropic-messages';
  }
  if (path === ENDPOINT_PATHS['openai-chat']) {
    return 'openai-chat';
  }
  if (path === MODELS_PATH) {
    return MODELS_PATH;
  }
  if (path === '/v1/responses') {
    throw new RoutingError('openai-responses format is deferred (see spec §17)', 501);
  }
  throw new RoutingError(`unknown path '${path}'`, 404);
}

/**
 * Build a validated routing table. Throws RoutingConfigError (load-time,
 * fail-loud) on any config violation; the caller keeps the last valid table.
 */
export function createRoutingTable(config: RoutingConfig): RoutingTable {
  for (const [key, provider] of Object.entries(config.providers)) {
    if (key !== provider.id) {
      throw new RoutingConfigError(
        `providers["${key}"]: id mismatch (provider declares "${provider.id}")`,
      );
    }
    validateProvider(provider);
  }
  for (const [index, binding] of config.models.entries()) {
    if (binding.match.length === 0) {
      throw new RoutingConfigError(`models[${index}]: match must be a non-empty glob`);
    }
    if (config.providers[binding.provider] === undefined) {
      throw new RoutingConfigError(
        `models[${index}]: unknown provider "${binding.provider}"`,
      );
    }
    if (binding.modelId.length === 0) {
      throw new RoutingConfigError(
        `models[${index}]: modelId must be a non-empty string or "$MODEL"`,
      );
    }
  }
  if (
    config.defaultProvider !== undefined &&
    config.providers[config.defaultProvider] === undefined
  ) {
    throw new RoutingConfigError(
      `defaultProvider "${config.defaultProvider}" is not defined in providers`,
    );
  }

  const resolve = (logicalModel: string, path: string): RouteResolution => {
    const inbound = classifyPath(path);
    if (inbound === MODELS_PATH) {
      throw new RoutingError(
        `${MODELS_PATH} is synthesized locally — use listModels()`,
        404,
      );
    }
    for (const binding of config.models) {
      if (globMatch(binding.match, logicalModel)) {
        const provider = config.providers[binding.provider];
        if (provider === undefined) {
          // Unreachable: validated above; kept for exhaustiveness under noUncheckedIndexedAccess.
          throw new RoutingConfigError(`models: unknown provider "${binding.provider}"`);
        }
        return {
          provider,
          physicalModel: binding.modelId === '$MODEL' ? logicalModel : binding.modelId,
          inboundFormat: inbound,
          outboundFormat: provider.wireFormat,
          plugins: mergePluginLayers(config.plugins, provider.plugins, binding.plugins),
        };
      }
    }
    throw new RoutingError(`no binding for model ${logicalModel}`, 400);
  };

  const resolveModelLess = (_path: string): RouteResolution => {
    if (config.defaultProvider === undefined) {
      throw new RoutingError('no defaultProvider configured for model-less request', 501);
    }
    const provider = config.providers[config.defaultProvider];
    if (provider === undefined) {
      // Unreachable: validated above.
      throw new RoutingConfigError(
        `defaultProvider "${config.defaultProvider}" is not defined in providers`,
      );
    }
    return {
      provider,
      physicalModel: undefined,
      inboundFormat: undefined,
      outboundFormat: provider.wireFormat,
      plugins: mergePluginLayers(config.plugins, provider.plugins),
    };
  };

  const listModels = (): string[] => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const binding of config.models) {
      if (!seen.has(binding.match)) {
        seen.add(binding.match);
        names.push(binding.match);
      }
    }
    return names;
  };

  return { resolve, resolveModelLess, listModels };
}
