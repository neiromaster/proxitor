import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProviderRouting,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
  matchScore,
  type ProxyConfig,
  resolveModelConfig,
} from './config.js';
import { proxyConfigFileSchema } from './config-schema.js';

describe('loadConfig', () => {
  it('should use defaults when no config provided', async () => {
    const config = await loadConfig({
      openrouterKey: 'test-key',
    });
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8828);
    expect(config.openrouterKey).toBe('test-key');
    expect(config.verbose).toBe(false);
  });

  it('should accept CLI options', async () => {
    const config = await loadConfig({
      host: '127.0.0.1',
      port: 3000,
      openrouterKey: 'test-key',
      verbose: true,
    });
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.verbose).toBe(true);
  });

  it('should throw if no API key is provided', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(loadConfig({ noConfig: true })).rejects.toThrow(
      'OpenRouter API key is required',
    );
  });
});

describe('matchScore', () => {
  it('should return high score for exact match', () => {
    expect(matchScore('claude-sonnet-4-6', 'claude-sonnet-4-6')).toBeGreaterThan(1000);
  });

  it('should return -1 for no match', () => {
    expect(matchScore('gpt-4o', 'claude-sonnet-4-6')).toBe(-1);
  });

  it('should return pattern length for prefix wildcard match', () => {
    expect(matchScore('claude-*', 'claude-sonnet-4-6')).toBe('claude-*'.length);
  });

  it('should return -1 when wildcard does not match', () => {
    expect(matchScore('gpt-*', 'claude-sonnet-4-6')).toBe(-1);
  });

  it('exact match should beat prefix match', () => {
    const exact = matchScore('claude-sonnet-4-6', 'claude-sonnet-4-6');
    const prefix = matchScore('claude-*', 'claude-sonnet-4-6');
    expect(exact).toBeGreaterThan(prefix);
  });

  it('longer prefix should beat shorter prefix', () => {
    const longer = matchScore('claude-sonnet-*', 'claude-sonnet-4-6');
    const shorter = matchScore('claude-*', 'claude-sonnet-4-6');
    expect(longer).toBeGreaterThan(shorter);
  });
});

describe('buildProviderRouting', () => {
  it('should return undefined for no provider', () => {
    expect(buildProviderRouting(undefined)).toBeUndefined();
  });

  it('should build "only" routing', () => {
    expect(buildProviderRouting({ only: 'deepinfra' })).toEqual({ only: ['deepinfra'] });
  });

  it('should build "order" routing with default allow_fallbacks', () => {
    expect(buildProviderRouting({ order: 'anthropic' })).toEqual({
      order: ['anthropic'],
      allow_fallbacks: true,
    });
  });

  it('should respect allowFallbacks: false', () => {
    expect(buildProviderRouting({ order: 'anthropic', allowFallbacks: false })).toEqual({
      order: ['anthropic'],
      allow_fallbacks: false,
    });
  });

  it('should return undefined for provider with neither only nor order', () => {
    expect(buildProviderRouting({ allowFallbacks: true })).toBeUndefined();
  });

  it('should build "only" routing with array of providers', () => {
    expect(buildProviderRouting({ only: ['anthropic', 'openai'] })).toEqual({
      only: ['anthropic', 'openai'],
    });
  });

  it('should build "order" routing with array of providers', () => {
    expect(buildProviderRouting({ order: ['openai', 'together'] })).toEqual({
      order: ['openai', 'together'],
      allow_fallbacks: true,
    });
  });

  it('should return undefined for empty array in "only"', () => {
    expect(buildProviderRouting({ only: [] })).toBeUndefined();
  });

  it('should return undefined for empty array in "order"', () => {
    expect(buildProviderRouting({ order: [] })).toBeUndefined();
  });

  it('should build "ignore" routing with array', () => {
    expect(buildProviderRouting({ ignore: ['deepinfra'] })).toEqual({
      ignore: ['deepinfra'],
    });
  });

  it('should build routing with sort string', () => {
    expect(buildProviderRouting({ sort: 'throughput' })).toEqual({ sort: 'throughput' });
  });

  it('should build routing with sort object', () => {
    expect(buildProviderRouting({ sort: { by: 'price', partition: 'none' } })).toEqual({
      sort: { by: 'price', partition: 'none' },
    });
  });

  it('should build routing with quantizations', () => {
    expect(buildProviderRouting({ quantizations: ['fp8', 'int4'] })).toEqual({
      quantizations: ['fp8', 'int4'],
    });
  });

  it('should build routing with maxPrice', () => {
    expect(buildProviderRouting({ maxPrice: { prompt: 1, completion: 2 } })).toEqual({
      max_price: { prompt: 1, completion: 2 },
    });
  });

  it('should build routing with requireParameters', () => {
    expect(buildProviderRouting({ requireParameters: true })).toEqual({
      require_parameters: true,
    });
  });

  it('should build routing with dataCollection', () => {
    expect(buildProviderRouting({ dataCollection: 'deny' })).toEqual({
      data_collection: 'deny',
    });
  });

  it('should build routing with performance preferences', () => {
    expect(
      buildProviderRouting({
        preferredMinThroughput: { p90: 50 },
        preferredMaxLatency: { p90: 3 },
      }),
    ).toEqual({
      preferred_min_throughput: { p90: 50 },
      preferred_max_latency: { p90: 3 },
    });
  });

  it('should combine multiple fields', () => {
    expect(
      buildProviderRouting({
        order: ['anthropic'],
        allowFallbacks: false,
        requireParameters: true,
        dataCollection: 'deny',
      }),
    ).toEqual({
      order: ['anthropic'],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: 'deny',
    });
  });

  it('should return undefined when all fields resolve to empty', () => {
    expect(buildProviderRouting({ only: [], ignore: [] })).toBeUndefined();
  });
});

describe('resolveModelConfig', () => {
  const baseConfig: ProxyConfig = {
    host: '0.0.0.0',
    port: 8828,
    openrouterKey: 'test-key',
    openrouterBaseUrl: 'https://openrouter.ai/api',
    authType: 'bearer',
    verbose: false,
    bodyLimit: '50mb',
    attributionReferer: 'https://github.com/neiromaster/proxitor',
    attributionTitle: 'proxitor',
    cacheControl: 'auto',
    sessionId: 'auto',
    provider: { only: 'deepinfra' },
    headers: { 'X-Global': 'global-value' },
  };

  it('should return global config when no model name', () => {
    const resolved = resolveModelConfig(baseConfig);
    expect(resolved.provider).toEqual({ only: 'deepinfra' });
    expect(resolved.headers).toEqual({ 'X-Global': 'global-value' });
  });

  it('should return global config when no modelOverrides defined', () => {
    const resolved = resolveModelConfig(baseConfig, 'claude-sonnet-4-6');
    expect(resolved.provider).toEqual({ only: 'deepinfra' });
    expect(resolved.headers).toEqual({ 'X-Global': 'global-value' });
  });

  it('should match exact model name', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'claude-sonnet-4-6': {
          provider: { only: 'anthropic' },
          headers: { 'X-Custom': 'claude' },
        },
      },
    };
    const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
    expect(resolved.provider).toEqual({ only: 'anthropic' });
    expect(resolved.headers).toEqual({
      'X-Global': 'global-value',
      'X-Custom': 'claude',
    });
  });

  it('should match prefix pattern', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'claude-*': {
          provider: { order: 'anthropic' },
        },
      },
    };
    const resolved = resolveModelConfig(config, 'claude-opus-4');
    expect(resolved.provider).toEqual({ order: 'anthropic' });
    expect(resolved.headers).toEqual({ 'X-Global': 'global-value' });
  });

  it('should prefer exact match over prefix', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'claude-*': { provider: { order: 'anthropic' } },
        'claude-sonnet-4-6': { provider: { only: 'anthropic' } },
      },
    };
    const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
    expect(resolved.provider).toEqual({ only: 'anthropic' });
  });

  it('should prefer longer prefix over shorter', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'claude-*': { provider: { only: 'deepinfra' } },
        'claude-sonnet-*': { provider: { only: 'anthropic' } },
      },
    };
    const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
    expect(resolved.provider).toEqual({ only: 'anthropic' });
  });

  it('should merge headers (override wins on conflict)', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'gpt-*': {
          headers: { 'X-Global': 'overridden', 'X-New': 'added' },
        },
      },
    };
    const resolved = resolveModelConfig(config, 'gpt-4o');
    expect(resolved.headers).toEqual({ 'X-Global': 'overridden', 'X-New': 'added' });
  });

  it('should preserve global provider when override only sets headers', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'gpt-*': { headers: { 'X-Model': 'gpt' } },
      },
    };
    const resolved = resolveModelConfig(config, 'gpt-4o');
    expect(resolved.provider).toEqual({ only: 'deepinfra' });
    expect(resolved.headers).toEqual({ 'X-Global': 'global-value', 'X-Model': 'gpt' });
  });

  it('should return global config when no pattern matches', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      modelOverrides: {
        'gpt-*': { provider: { only: 'openai' } },
      },
    };
    const resolved = resolveModelConfig(config, 'llama-3');
    expect(resolved.provider).toEqual({ only: 'deepinfra' });
  });
});

// --- Schema validation tests ---

describe('proxyConfigFileSchema', () => {
  it('should accept empty config', () => {
    const result = proxyConfigFileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept valid full config', () => {
    const result = proxyConfigFileSchema.safeParse({
      host: '127.0.0.1',
      port: 3000,
      openrouterKey: 'sk-test',
      openrouterBaseUrl: 'https://openrouter.ai/api',
      verbose: true,
      bodyLimit: '10mb',
      attributionReferer: 'https://github.com/neiromaster/proxitor',
      attributionTitle: 'test',
      provider: { only: 'deepinfra', dataCollection: 'deny' },
      headers: { 'X-Custom': 'value' },
      modelOverrides: { 'claude-*': { provider: { order: 'anthropic' } } },
    });
    expect(result.success).toBe(true);
  });

  it('should reject unknown top-level fields', () => {
    const result = proxyConfigFileSchema.safeParse({ porrt: 8828 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('Unrecognized'))).toBe(
        true,
      );
    }
  });

  it('should reject unknown provider fields', () => {
    const result = proxyConfigFileSchema.safeParse({ provider: { onli: 'deepinfra' } });
    expect(result.success).toBe(false);
  });

  it('should reject negative port', () => {
    const result = proxyConfigFileSchema.safeParse({ port: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject port above 65535', () => {
    const result = proxyConfigFileSchema.safeParse({ port: 70000 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer port', () => {
    const result = proxyConfigFileSchema.safeParse({ port: 3.5 });
    expect(result.success).toBe(false);
  });

  it('should reject invalid dataCollection value', () => {
    const result = proxyConfigFileSchema.safeParse({
      provider: { dataCollection: 'maybe' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative maxPrice', () => {
    const result = proxyConfigFileSchema.safeParse({
      provider: { maxPrice: { prompt: -1 } },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid openrouterBaseUrl', () => {
    const result = proxyConfigFileSchema.safeParse({ openrouterBaseUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('should reject unknown model override fields', () => {
    const result = proxyConfigFileSchema.safeParse({
      modelOverrides: { 'gpt-*': { provder: {} } },
    });
    expect(result.success).toBe(false);
  });

  it('should accept string or array for provider.only', () => {
    expect(
      proxyConfigFileSchema.safeParse({ provider: { only: 'deepinfra' } }).success,
    ).toBe(true);
    expect(
      proxyConfigFileSchema.safeParse({ provider: { only: ['openai', 'azure'] } })
        .success,
    ).toBe(true);
  });

  it('should accept sort as string or object', () => {
    expect(
      proxyConfigFileSchema.safeParse({ provider: { sort: 'throughput' } }).success,
    ).toBe(true);
    expect(
      proxyConfigFileSchema.safeParse({
        provider: { sort: { by: 'price', partition: 'none' } },
      }).success,
    ).toBe(true);
  });
});

// --- File-based validation tests ---

describe('config file validation', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
    dirs.push(dir);
    return dir;
  }

  it('throws ConfigParseError on malformed YAML', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: [invalid');

    await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
      ConfigParseError,
    );
  });

  it('throws ConfigParseError on malformed JSON', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.json');
    writeFileSync(configPath, '{"port": }');

    await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
      ConfigParseError,
    );
  });

  it('throws ConfigValidationError on invalid field type', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'port: "not-a-number"');

    await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('throws ConfigValidationError on unknown field', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'porrt: 8828');

    await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
      ConfigValidationError,
    );
  });

  it('includes field path in ConfigValidationError message', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, ['provider:', '  dataCollection: maybe'].join('\n'));

    try {
      await loadConfig({ configPath, openrouterKey: 'test-key' });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as Error).message).toContain('dataCollection');
    }
  });
});

describe('cacheControl and sessionId config', () => {
  const baseConfig: ProxyConfig = {
    host: '0.0.0.0',
    port: 8828,
    openrouterKey: 'test-key',
    openrouterBaseUrl: 'https://openrouter.ai/api',
    authType: 'bearer',
    verbose: false,
    bodyLimit: '50mb',
    attributionReferer: 'https://github.com/neiromaster/proxitor',
    attributionTitle: 'proxitor',
    cacheControl: 'auto',
    sessionId: 'auto',
  };

  it('accepts cacheControl: auto', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'auto' });
    expect(result.success).toBe(true);
  });

  it('accepts cacheControl: always', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'always' });
    expect(result.success).toBe(true);
  });

  it('accepts cacheControl: never', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'never' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid cacheControl value', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'sometimes' });
    expect(result.success).toBe(false);
  });

  it('accepts sessionId: auto', () => {
    const result = proxyConfigFileSchema.safeParse({ sessionId: 'auto' });
    expect(result.success).toBe(true);
  });

  it('accepts sessionId: always', () => {
    const result = proxyConfigFileSchema.safeParse({ sessionId: 'always' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid sessionId value', () => {
    const result = proxyConfigFileSchema.safeParse({ sessionId: 'yes' });
    expect(result.success).toBe(false);
  });

  it('defaults cacheControl to auto', async () => {
    const config = await loadConfig({ openrouterKey: 'test-key' });
    expect(config.cacheControl).toBe('auto');
  });

  it('defaults sessionId to auto', async () => {
    const config = await loadConfig({ openrouterKey: 'test-key' });
    expect(config.sessionId).toBe('auto');
  });

  it('allows per-model cacheControl override', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      cacheControl: 'auto',
      modelOverrides: {
        'gpt-*': { cacheControl: 'never' },
      },
    };
    const resolved = resolveModelConfig(config, 'gpt-4o');
    expect(resolved.cacheControl).toBe('never');
  });

  it('allows per-model sessionId override', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      sessionId: 'auto',
      modelOverrides: {
        'claude-*': { sessionId: 'always' },
      },
    };
    const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
    expect(resolved.sessionId).toBe('always');
  });

  it('resolves global cacheControl when no model override', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      cacheControl: 'always',
    };
    const resolved = resolveModelConfig(config, 'gpt-4o');
    expect(resolved.cacheControl).toBe('always');
  });
});
