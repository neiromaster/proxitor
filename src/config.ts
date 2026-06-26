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
import { parseModelSlug } from './model-id.js';
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
  rewriteBlockTtl: TriState;
  sessionId: TriState;
  normalizeResponses: TriState;
  normalizeVolatileSystem: boolean;
  matchedOverride?: string;
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

/** Slug after the vendor prefix; bare ids keep their text. Delegates to parseModelSlug. */
function modelSlug(s: string): string {
  return parseModelSlug(s) || s;
}

export function matchScore(pattern: string, modelName: string): number {
  // Tiers (length breaks ties within a tier): full exact 3000 > full prefix* 2000 > slug exact 1000 > slug prefix*.
  if (pattern === modelName) return 3000 + pattern.length;
  if (pattern.endsWith('*') && modelName.startsWith(pattern.slice(0, -1))) {
    return 2000 + pattern.length;
  }
  // Slug tiers bridge bare <-> vendor-prefixed only — never two different vendor
  // prefixes, or openai/gpt-4o would capture azure/gpt-4o. Same-vendor is above.
  if (pattern.includes('/') && modelName.includes('/')) return -1;
  const sp = modelSlug(pattern);
  const sm = modelSlug(modelName);
  if (sp === sm) return 1000 + sp.length;
  if (sp.endsWith('*') && sm.startsWith(sp.slice(0, -1))) return sp.length;
  return -1;
}

export function matchesPattern(pattern: string, modelName: string): boolean {
  return matchScore(pattern, modelName) >= 0;
}

export type SlugCollision = { slug: string; keys: string[]; winner: string };

/** Override keys sharing a slug. `winner` is the key a bare name resolves to — not always `keys[0]`, since a bare key wins on the full-exact tier. Pure; callers log it. */
export function detectSlugCollisions(
  overrides: Record<string, unknown> | undefined,
): SlugCollision[] {
  if (!overrides) return [];
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(overrides)) {
    const slug = modelSlug(key);
    const keys = groups.get(slug);
    if (keys) keys.push(key);
    else groups.set(slug, [key]);
  }
  const collisions: SlugCollision[] = [];
  for (const [slug, keys] of groups) {
    if (keys.length <= 1) continue;
    // winner is never null here (all keys share the bare slug → slug-exact tier);
    // the guard narrows string|null → string, since noNonNullAssertion is on.
    const winner = findBestMatch(keys, slug);
    if (winner) collisions.push({ slug, keys, winner });
  }
  return collisions;
}

/** Warning text for a same-slug collision. */
export function formatSlugCollisionWarning(c: SlugCollision): string {
  return (
    `Overrides ${c.keys.map(k => `"${k}"`).join(' and ')} share model slug "${c.slug}"; ` +
    `a bare name resolves to "${c.winner}". ` +
    `Use the vendor-prefixed name to pick a specific one.`
  );
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
    rewriteBlockTtl: config.rewriteBlockTtl,
    sessionId: config.sessionId,
    normalizeResponses: config.normalizeResponses,
    normalizeVolatileSystem: config.normalizeVolatileSystem,
  };

  if (!modelName || !config.modelOverrides) return result;

  const bestPattern = findBestMatch(Object.keys(config.modelOverrides), modelName);
  if (bestPattern) {
    applyOverride(result, config.modelOverrides[bestPattern]);
    result.matchedOverride = bestPattern;
  }

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
  if (override.rewriteBlockTtl !== undefined) {
    result.rewriteBlockTtl = override.rewriteBlockTtl;
  }
  if (override.sessionId !== undefined) result.sessionId = override.sessionId;
  if (override.normalizeResponses !== undefined) {
    result.normalizeResponses = override.normalizeResponses;
  }
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

function parseConfigFile(filePath: string): unknown {
  const content = readFileSync(filePath, 'utf-8');
  try {
    return filePath.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
  } catch (err) {
    // biome-ignore lint/style/useErrorCause: cause is propagated inside ConfigParseError
    throw new ConfigParseError(filePath, err instanceof Error ? err : undefined);
  }
}

export function readConfigFile(filePath: string): Partial<ProxyConfig> {
  const result = proxyConfigFileSchema.safeParse(parseConfigFile(filePath));
  if (!result.success) {
    throw new ConfigValidationError(filePath, result.error);
  }

  return result.data;
}

/**
 * Validated like readConfigFile, but schema defaults are NOT applied, so absent
 * keys stay undefined — use when "absent" must differ from "explicit default".
 */
export function readConfigFileRaw(filePath: string): Partial<ProxyConfig> {
  const raw = parseConfigFile(filePath);
  const result = proxyConfigFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(filePath, result.error);
  }

  return (raw ?? {}) as Partial<ProxyConfig>;
}
