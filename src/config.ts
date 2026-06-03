import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { toArray } from './utils.js'

export type ProviderConfig = {
  /** Allow only these providers (e.g. "deepinfra" or ["anthropic", "openai"]) */
  only?: string | string[]
  /** Try providers in this order (e.g. "anthropic" or ["openai", "together"]) */
  order?: string | string[]
  /** Allow fallback to other providers (default: true) */
  allowFallbacks?: boolean
}

/** Per-model override: layers on top of global config */
export type ModelOverride = {
  /** Override provider routing for matching models */
  provider?: ProviderConfig
  /** Additional headers to merge for matching models */
  headers?: Record<string, string>
}

/** Result of merging global config with a model-specific override */
export type ResolvedModelConfig = {
  provider?: ProviderConfig
  headers?: Record<string, string>
}

export type ProxyConfig = {
  host: string
  port: number
  openrouterKey: string
  openrouterBaseUrl: string
  verbose: boolean
  /** Request body size limit (default: "50mb") */
  bodyLimit: string
  /** Provider routing configuration (global default) */
  provider?: ProviderConfig
  /** HTTP-Referer for OpenRouter attribution */
  attributionReferer: string
  /** X-Title for OpenRouter attribution */
  attributionTitle: string
  /** Custom headers to add to proxied requests (global default) */
  headers?: Record<string, string>
  /** Per-model config overrides. Keys are exact model names or prefix patterns (e.g. "claude-*") */
  modelOverrides?: Record<string, ModelOverride>
}

const DEFAULT_CONFIG: ProxyConfig = {
  host: '0.0.0.0',
  port: 8080,
  openrouterKey: '',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  verbose: false,
  bodyLimit: '50mb',
  attributionReferer: 'http://localhost',
  attributionTitle: 'proxitor',
}

type LoadConfigOptions = {
  configPath?: string
  host?: string
  openrouterKey?: string
  port?: number
  verbose?: boolean
}

/** Build the provider routing object for OpenRouter request body injection */
export function buildProviderRouting(
  provider?: ProviderConfig,
): Record<string, unknown> | undefined {
  if (!provider) return undefined

  if (provider.only) {
    const only = toArray(provider.only)
    return only ? { only } : undefined
  }

  if (provider.order) {
    const order = toArray(provider.order)
    return order ? { order, allow_fallbacks: provider.allowFallbacks ?? true } : undefined
  }

  return undefined
}

/** Score a pattern against a model name. Higher = better match. -1 = no match. */
export function matchScore(pattern: string, modelName: string): number {
  if (pattern === modelName) return modelName.length + 1000

  if (pattern.endsWith('*') && modelName.startsWith(pattern.slice(0, -1))) {
    return pattern.length
  }

  return -1
}

/** Resolve the effective config for a given model by merging global defaults with the best-matching override */
export function resolveModelConfig(
  config: ProxyConfig,
  modelName?: string,
): ResolvedModelConfig {
  const result: ResolvedModelConfig = {
    provider: config.provider,
    headers: config.headers ? { ...config.headers } : undefined,
  }

  if (!modelName || !config.modelOverrides) return result

  let bestPattern: string | null = null
  let bestScore = -1

  for (const pattern of Object.keys(config.modelOverrides)) {
    const score = matchScore(pattern, modelName)
    if (score > bestScore) {
      bestScore = score
      bestPattern = pattern
    }
  }

  if (bestPattern) {
    const override = config.modelOverrides[bestPattern]
    if (override?.provider !== undefined) {
      result.provider = override.provider
    }
    if (override?.headers) {
      result.headers = { ...(result.headers ?? {}), ...override.headers }
    }
  }

  return result
}

export async function loadConfig(options: LoadConfigOptions): Promise<ProxyConfig> {
  const config = { ...DEFAULT_CONFIG }

  const configPath = findConfigFile(options.configPath)
  if (configPath) {
    const fileConfig = readConfigFile(configPath)
    Object.assign(config, fileConfig)
  }

  if (options.host) config.host = options.host
  if (options.port) config.port = options.port
  if (options.verbose) config.verbose = options.verbose

  if (options.openrouterKey) {
    config.openrouterKey = options.openrouterKey
  } else if (!config.openrouterKey) {
    config.openrouterKey = process.env.OPENROUTER_API_KEY ?? ''
  }

  if (!config.openrouterKey) {
    throw new Error(
      'OpenRouter API key is required. Set OPENROUTER_API_KEY env var, pass --openrouter-key flag, or set it in config file.',
    )
  }

  return config
}

function findConfigFile(explicitPath?: string): string | null {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`)
    }
    return explicitPath
  }

  const candidates = [
    'proxitor.config.yaml',
    'proxitor.config.yml',
    'proxitor.config.json',
    '.proxitor.yaml',
    '.proxitor.yml',
    '.proxitor.json',
  ]

  for (const candidate of candidates) {
    const fullPath = resolve(candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}

function readConfigFile(filePath: string): Partial<ProxyConfig> {
  const content = readFileSync(filePath, 'utf-8')

  if (filePath.endsWith('.json')) {
    return JSON.parse(content) as Partial<ProxyConfig>
  }

  return yaml.load(content) as Partial<ProxyConfig>
}
