/**
 * Proxitor — lightweight proxy for routing CLI requests to OpenRouter.
 *
 * @packageDocumentation
 */

export type {
  ModelOverride,
  ProviderConfig,
  ProxyConfig,
  ResolvedModelConfig,
} from './config.js';
export {
  buildProviderRouting,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
  matchScore,
  resolveModelConfig,
} from './config.js';
export { isAnthropicModel } from './proxy/utils/model.js';
export { createProxyServer } from './proxy.js';
export { toArray } from './utils.js';
