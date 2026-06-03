/**
 * Proxitor — lightweight proxy for routing CLI requests to OpenRouter.
 *
 * @packageDocumentation
 */

export type { ProviderConfig, ProxyConfig } from './config.js'
export { buildProviderRouting, loadConfig } from './config.js'
export { createProxyServer } from './proxy.js'
