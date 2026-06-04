import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import {
  ConfigParseError,
  ConfigValidationError,
  type ProviderConfig,
  type ProxyConfig,
  proxyConfigFileSchema,
} from './config-schema.js'
import { toArray } from './utils.js'

export type {
  MaxPrice,
  ModelOverride,
  PercentileCutoffs,
  ProviderConfig,
  ProviderSort,
  ProxyConfig,
} from './config-schema.js'
export { ConfigParseError, ConfigValidationError } from './config-schema.js'

/** Result of merging global config with a model-specific override */
export type ResolvedModelConfig = {
  provider?: ProviderConfig
  headers?: Record<string, string>
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
  noConfig?: boolean
  host?: string
  openrouterKey?: string
  port?: number
  verbose?: boolean
}

/** Fields that need toArray normalization (string | string[] → string[] | undefined) */
const ARRAY_FIELDS: ReadonlyArray<{ key: keyof ProviderConfig; apiName: string }> = [
  { key: 'only', apiName: 'only' },
  { key: 'order', apiName: 'order' },
  { key: 'ignore', apiName: 'ignore' },
  { key: 'quantizations', apiName: 'quantizations' },
] as const

/** Direct camelCase → snake_case field mappings */
const DIRECT_FIELDS: ReadonlyArray<{ key: keyof ProviderConfig; apiName: string }> = [
  { key: 'sort', apiName: 'sort' },
  { key: 'maxPrice', apiName: 'max_price' },
  { key: 'requireParameters', apiName: 'require_parameters' },
  { key: 'dataCollection', apiName: 'data_collection' },
  { key: 'zdr', apiName: 'zdr' },
  { key: 'enforceDistillableText', apiName: 'enforce_distillable_text' },
  { key: 'preferredMinThroughput', apiName: 'preferred_min_throughput' },
  { key: 'preferredMaxLatency', apiName: 'preferred_max_latency' },
] as const

/** Build the provider routing object for OpenRouter request body injection */
export function buildProviderRouting(
  provider?: ProviderConfig,
): Record<string, unknown> | undefined {
  if (!provider) return undefined

  const result: Record<string, unknown> = {}

  for (const { key, apiName } of ARRAY_FIELDS) {
    const value = provider[key]
    if (value !== undefined) {
      const normalized = toArray(value as string | string[])
      if (normalized) result[apiName] = normalized
    }
  }

  for (const { key, apiName } of DIRECT_FIELDS) {
    const value = provider[key]
    if (value !== undefined) result[apiName] = value
  }

  if (result.order) {
    result.allow_fallbacks = provider.allowFallbacks ?? true
  }

  return Object.keys(result).length > 0 ? result : undefined
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

  if (!options.noConfig) {
    const configPath = findConfigFile(options.configPath)
    if (configPath) {
      const fileConfig = readConfigFile(configPath)
      Object.assign(config, fileConfig)
    }
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

/** Resolve XDG config directory: $XDG_CONFIG_HOME/proxitor or ~/.config/proxitor */
function getXdgConfigDir(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME
  return xdgHome ? resolve(xdgHome, 'proxitor') : join(homedir(), '.config', 'proxitor')
}

export function findConfigFile(explicitPath?: string): string | null {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`)
    }
    return resolve(explicitPath)
  }

  const localCandidates = [
    'proxitor.config.yaml',
    'proxitor.config.yml',
    'proxitor.config.json',
    '.proxitor.yaml',
    '.proxitor.yml',
    '.proxitor.json',
  ]

  for (const candidate of localCandidates) {
    const fullPath = resolve(candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }

  const xdgDir = getXdgConfigDir()
  const xdgCandidates = ['config.yaml', 'config.yml', 'config.json']

  for (const candidate of xdgCandidates) {
    const fullPath = join(xdgDir, candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }

  return null
}

export function readConfigFile(filePath: string): Partial<ProxyConfig> {
  const content = readFileSync(filePath, 'utf-8')
  let raw: unknown

  try {
    raw = filePath.endsWith('.json') ? JSON.parse(content) : yaml.load(content)
  } catch (err) {
    // biome-ignore lint/nursery/useErrorCause: cause is propagated inside ConfigParseError
    throw new ConfigParseError(filePath, err instanceof Error ? err : undefined)
  }

  const result = proxyConfigFileSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigValidationError(filePath, result.error)
  }

  return result.data
}
