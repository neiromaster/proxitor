import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

export type ProxyConfig = {
  host: string
  port: number
  openrouterKey: string
  openrouterBaseUrl: string
  verbose: boolean
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
}

type LoadConfigOptions = {
  configPath?: string
  host?: string
  openrouterKey?: string
  port?: number
  verbose?: boolean
}

export async function loadConfig(options: LoadConfigOptions): Promise<ProxyConfig> {
  const config = { ...DEFAULT_CONFIG }

  // Try loading config file
  const configPath = findConfigFile(options.configPath)
  if (configPath) {
    const fileConfig = readConfigFile(configPath)
    Object.assign(config, fileConfig)
  }

  // CLI flags override config file
  if (options.host) config.host = options.host
  if (options.port) config.port = options.port
  if (options.verbose) config.verbose = options.verbose

  // OpenRouter key: CLI flag > config file > env var
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
