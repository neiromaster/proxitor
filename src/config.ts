import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  ConfigParseError,
  ConfigValidationError,
  DEFAULTS,
  MissingConfigError,
  type ModelOverride,
  type ProviderConfig,
  type ProxyConfig,
  proxyConfigFileSchema,
  proxyConfigSchema,
  type TriState,
} from './config-schema.js';
import { toArray } from './utils.js';

export type {
  AuthType,
  ModelOverride,
  ProviderConfig,
  ProxyConfig,
  TriState,
} from './config-schema.js';
export {
  ConfigParseError,
  ConfigValidationError,
  DEFAULTS,
  MissingConfigError,
} from './config-schema.js';

export type ResolvedModelConfig = {
  provider?: ProviderConfig;
  headers?: Record<string, string>;
  cacheControl: TriState;
  cacheControlTtl?: '5m' | '1h' | 'omit' | 'skip';
  sessionId: TriState;
  normalizeVolatileSystem: boolean;
};

const ARRAY_FIELDS: ReadonlyArray<{ key: keyof ProviderConfig; apiName: string }> = [
  { key: 'only', apiName: 'only' },
  { key: 'order', apiName: 'order' },
  { key: 'ignore', apiName: 'ignore' },
  { key: 'quantizations', apiName: 'quantizations' },
] as const;

const DIRECT_FIELDS: ReadonlyArray<{ key: keyof ProviderConfig; apiName: string }> = [
  { key: 'sort', apiName: 'sort' },
  { key: 'maxPrice', apiName: 'max_price' },
  { key: 'requireParameters', apiName: 'require_parameters' },
  { key: 'dataCollection', apiName: 'data_collection' },
  { key: 'zdr', apiName: 'zdr' },
  { key: 'enforceDistillableText', apiName: 'enforce_distillable_text' },
  { key: 'preferredMinThroughput', apiName: 'preferred_min_throughput' },
  { key: 'preferredMaxLatency', apiName: 'preferred_max_latency' },
] as const;

export function buildProviderRouting(
  provider?: ProviderConfig,
): Record<string, unknown> | undefined {
  if (!provider) return undefined;

  const result: Record<string, unknown> = {};

  for (const { key, apiName } of ARRAY_FIELDS) {
    const value = provider[key];
    if (value !== undefined) {
      const normalized = toArray(value as string | string[]);
      if (normalized) result[apiName] = normalized;
    }
  }

  for (const { key, apiName } of DIRECT_FIELDS) {
    const value = provider[key];
    if (value !== undefined) result[apiName] = value;
  }

  if (result.order) {
    result.allow_fallbacks = provider.allowFallbacks ?? true;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function matchScore(pattern: string, modelName: string): number {
  if (pattern === modelName) return modelName.length + 1000;

  if (pattern.endsWith('*') && modelName.startsWith(pattern.slice(0, -1))) {
    return pattern.length;
  }

  return -1;
}

export function matchesPattern(pattern: string, modelName: string): boolean {
  return matchScore(pattern, modelName) >= 0;
}

export function resolveModelConfig(
  config: ProxyConfig,
  modelName?: string,
): ResolvedModelConfig {
  const result: ResolvedModelConfig = {
    provider: config.provider,
    headers: config.headers ? { ...config.headers } : undefined,
    cacheControl: config.cacheControl,
    cacheControlTtl: config.cacheControlTtl,
    sessionId: config.sessionId,
    normalizeVolatileSystem: config.normalizeVolatileSystem,
  };

  if (!modelName || !config.modelOverrides) return result;

  const bestPattern = findBestMatch(Object.keys(config.modelOverrides), modelName);
  if (bestPattern) applyOverride(result, config.modelOverrides[bestPattern]);

  return result;
}

function findBestMatch(patterns: string[], modelName: string): string | null {
  let bestPattern: string | null = null;
  let bestScore = -1;
  for (const pattern of patterns) {
    const score = matchScore(pattern, modelName);
    if (score > bestScore) {
      bestScore = score;
      bestPattern = pattern;
    }
  }
  return bestPattern;
}

function applyOverride(result: ResolvedModelConfig, override?: ModelOverride): void {
  if (!override) return;
  if (override.provider !== undefined) result.provider = override.provider;
  if (override.headers) {
    result.headers = { ...(result.headers ?? {}), ...override.headers };
  }
  if (override.cacheControl !== undefined) result.cacheControl = override.cacheControl;
  if (override.cacheControlTtl !== undefined) {
    result.cacheControlTtl = override.cacheControlTtl;
  }
  if (override.sessionId !== undefined) result.sessionId = override.sessionId;
  if (override.normalizeVolatileSystem !== undefined) {
    result.normalizeVolatileSystem = override.normalizeVolatileSystem;
  }
}

/** Reject base URLs ending in /v1 — paths are forwarded as-is, so /v1 suffix causes doubled paths. */
function throwIfV1Suffix(url: string, field: string): void {
  const { pathname } = new URL(url);
  if (pathname.endsWith('/v1') || pathname.endsWith('/v1/')) {
    throw new Error(
      `${field} "${url}" ends with /v1 — paths are now forwarded as-is, so this would produce doubled paths like /v1/v1/chat/completions. ` +
        `Remove the /v1 suffix (use "${url.replace(/\/v1\/?$/, '')}")`,
    );
  }
}

export type LoadConfigOptions = {
  configPath?: string;
  noConfig?: boolean;
  host?: string;
  openrouterKey?: string;
  port?: number;
  verbose?: boolean;
};

export async function loadConfig(options: LoadConfigOptions): Promise<ProxyConfig> {
  let fileConfig: Partial<ProxyConfig> = {};
  if (!options.noConfig) {
    const configPath = tryFindConfigFile(options.configPath);
    if (configPath) {
      fileConfig = readConfigFile(configPath);
    }
  }

  const merged = {
    ...DEFAULTS,
    ...fileConfig,
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
    openrouterKey:
      options.openrouterKey ||
      fileConfig.openrouterKey ||
      process.env.OPENROUTER_API_KEY ||
      '',
  };

  const result = proxyConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigValidationError('(merged config)', result.error);
  }

  if (!result.data.openrouterKey) {
    throw new Error(
      'OpenRouter API key is required. Set OPENROUTER_API_KEY env var, pass --openrouter-key flag, or set it in config file.',
    );
  }

  throwIfV1Suffix(result.data.openrouterBaseUrl, 'openrouterBaseUrl');
  if (result.data.openrouterDataUrl) {
    throwIfV1Suffix(result.data.openrouterDataUrl, 'openrouterDataUrl');
  }

  return result.data;
}

export function getXdgConfigDir(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME;
  return xdgHome ? resolve(xdgHome, 'proxitor') : join(homedir(), '.config', 'proxitor');
}

const LOCAL_CONFIG_CANDIDATES = [
  'proxitor.config.yaml',
  'proxitor.config.yml',
  'proxitor.config.json',
  '.proxitor.yaml',
  '.proxitor.yml',
  '.proxitor.json',
] as const;

const XDG_CONFIG_CANDIDATES = ['config.yaml', 'config.yml', 'config.json'] as const;

export function getConfigSearchPaths(): string[] {
  return [
    ...LOCAL_CONFIG_CANDIDATES.map(c => resolve(c)),
    ...XDG_CONFIG_CANDIDATES.map(c => join(getXdgConfigDir(), c)),
  ];
}

/** Returns first existing config file, or null. Use when "no config" is valid (wizard, doctor, validate). */
export function tryFindConfigFile(explicitPath?: string): string | null {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`);
    }
    return resolve(explicitPath);
  }

  for (const fullPath of getConfigSearchPaths()) {
    if (existsSync(fullPath)) return fullPath;
  }

  return null;
}

/** Like tryFindConfigFile but throws MissingConfigError when no config is found. */
export function findConfigFile(explicitPath?: string): string {
  const found = tryFindConfigFile(explicitPath);
  if (found) return found;
  throw new MissingConfigError(getConfigSearchPaths());
}

export function readConfigFile(filePath: string): Partial<ProxyConfig> {
  const content = readFileSync(filePath, 'utf-8');
  let raw: unknown;

  try {
    raw = filePath.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
  } catch (err) {
    // biome-ignore lint/style/useErrorCause: cause is propagated inside ConfigParseError
    throw new ConfigParseError(filePath, err instanceof Error ? err : undefined);
  }

  const result = proxyConfigFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(filePath, result.error);
  }

  return result.data;
}
