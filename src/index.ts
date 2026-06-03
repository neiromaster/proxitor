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
} from './config.js'
export {
  buildProviderRouting,
  loadConfig,
  matchScore,
  resolveModelConfig,
} from './config.js'
export { extractModel } from './proxy/inject.js'
export { createProxyServer } from './proxy.js'
export { toArray, tryParseBody } from './utils.js'
