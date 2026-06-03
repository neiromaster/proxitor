import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

export type ProviderConfig = {
  /** Use only this provider (e.g. "deepinfra") */
  only?: string
  /** Try providers in this order (single slug, e.g. "anthropic") */
  order?: string
  /** Allow fallback to other providers (default: true) */
  allowFallbacks?: boolean
}

export type ProxyConfig = {
  host: string
  port: number
  openrouterKey: string
  openrouterBaseUrl: string
  verbose: boolean
  /** Request body size limit (default: "50mb") */
  bodyLimit: string
  /** Provider routing configuration */
  provider?: ProviderConfig
  /** HTTP-Referer for OpenRouter attribution */
  attributionReferer: string
  /** X-Title for OpenRouter attribution */
  attributionTitle: string
  /** Map of CLI tool names to their model overrides */
  models?: Record<string, string>
  /** Custom headers to add to proxied requests */
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
  host?: string
  openrouterKey?: string
  port?: number
  verbose?: boolean
}

/** Build the provider routing object for OpenRouter request body injection */
export function buildProviderRouting(
  config: ProxyConfig,
): Record<string, unknown> | undefined {
  const { provider } = config
  if (!provider) return undefined

  if (provider.only) {
    return { only: [provider.only] }
  }

  if (provider.order) {
    return {
      order: [provider.order],
      allow_fallbacks: provider.allowFallbacks ?? true,
    }
  }

  return undefined
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
