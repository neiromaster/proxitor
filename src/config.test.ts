import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildProviderRouting,
  ConfigParseError,
  ConfigValidationError,
  DEFAULTS,
  detectSlugCollisions,
  findConfigFile,
  formatSlugCollisionWarning,
  getConfigSearchPaths,
  loadConfig,
  MissingConfigError,
  matchScore,
  type ProxyConfig,
  readConfigFile,
  readConfigFileRaw,
  resolveModelConfig,
  tryFindConfigFile,
} from './config.js';
import { proxyConfigFileSchema } from './config-schema.js';

describe('loadConfig', () => {
  it('should use defaults when no config provided', async () => {
    const config = await loadConfig({
      noConfig: true,
      openrouterKey: 'test-key',
    });
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8828);
    expect(config.openrouterKey).toBe('test-key');
    expect(config.verbose).toBe(false);
  });

  it('should accept CLI options', async () => {
    const config = await loadConfig({
      noConfig: true,
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

  it('should use defaults when no config file exists and openrouterKey is provided (bugfix #2)', async () => {
    // loadConfig uses tryFindConfigFile now (not findConfigFile), so it returns
    // defaults when no config file is found — instead of throwing MissingConfigError.
    // This allows config-less commands like `browse --openrouter-key sk-xxx` to work.
    delete process.env.OPENROUTER_API_KEY;
    const savedCwd = process.cwd();
    const tmpDir = mkdtempSync(join(tmpdir(), 'proxitor-noconfig-'));
    process.chdir(tmpDir);
    try {
      const config = await loadConfig({ openrouterKey: 'test-key-from-flag' });
      expect(config.openrouterKey).toBe('test-key-from-flag');
      expect(config.port).toBe(8828);
      expect(config.host).toBe('0.0.0.0');
    } finally {
      process.chdir(savedCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('config file discovery', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    // Hide the real repo config (CWD candidate) from discovery. XDG discovery
    // is sandboxed globally by tests/setup.ts, so only the cwd needs hiding.
    process.chdir(tmpdir());
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  describe('tryFindConfigFile', () => {
    it('returns null when no config exists and no explicit path', () => {
      expect(tryFindConfigFile()).toBeNull();
    });

    it('returns the explicit path when it exists', () => {
      const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
      const configPath = join(dir, 'my-config.yaml');
      writeFileSync(configPath, 'port: 9090');
      try {
        expect(tryFindConfigFile(configPath)).toBe(configPath);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('throws a clear error when explicit path is missing', () => {
      expect(() => tryFindConfigFile('/nonexistent/config.yaml')).toThrow(
        'Config file not found',
      );
    });

    it('finds a local config file in cwd', () => {
      const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
      const configPath = join(dir, 'proxitor.config.yaml');
      writeFileSync(configPath, 'port: 9090');
      // On macOS, /tmp and /var/folders/... resolve through /private. Use realpath
      // so the assertion survives the symlink resolution that process.cwd applies.
      process.chdir(dir);
      try {
        const found = tryFindConfigFile();
        expect(found).toBe(realpathSync(configPath));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('findConfigFile', () => {
    it('throws MissingConfigError when discovery fails', () => {
      try {
        findConfigFile();
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingConfigError);
        expect((err as MissingConfigError).searchedPaths.length).toBeGreaterThan(0);
        expect((err as Error).message).toContain('No proxitor config file found');
      }
    });

    it('delegates to tryFindConfigFile when explicit path is given', () => {
      expect(() => findConfigFile('/nonexistent/config.yaml')).toThrow(
        'Config file not found',
      );
    });
  });

  describe('getConfigSearchPaths', () => {
    it('returns an absolute path for every candidate', () => {
      const paths = getConfigSearchPaths();
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(p.startsWith('/')).toBe(true);
      }
    });
  });

  describe('MissingConfigError', () => {
    it('includes every searched path in the message', () => {
      const err = new MissingConfigError(['/a', '/b']);
      expect(err.name).toBe('MissingConfigError');
      expect(err.message).toContain('/a');
      expect(err.message).toContain('/b');
      expect(err.message).toContain('proxitor config wizard');
    });
  });
});

describe('matchScore', () => {
  it('should return high score for exact match', () => {
    expect(matchScore('claude-sonnet-4-6', 'claude-sonnet-4-6')).toBeGreaterThan(1000);
  });

  it('should return -1 for no match', () => {
    expect(matchScore('gpt-4o', 'claude-sonnet-4-6')).toBe(-1);
  });

  it('should return full-prefix-tier score for prefix wildcard match', () => {
    expect(matchScore('claude-*', 'claude-sonnet-4-6')).toBe(2000 + 'claude-*'.length);
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

  it('slug exact: bare name matches vendor-prefixed key', () => {
    expect(matchScore('moonshotai/kimi-k2.6', 'kimi-k2.6')).toBe(
      1000 + 'kimi-k2.6'.length,
    );
  });

  it('strict * isolation: dated slug does not match a non-* key (both directions)', () => {
    expect(matchScore('moonshotai/kimi-k2.6', 'moonshotai/kimi-k2.6-20260420')).toBe(-1);
    expect(matchScore('moonshotai/kimi-k2.6-20260420', 'kimi-k2.6')).toBe(-1);
  });

  it('explicit * matches dated slug (both planes)', () => {
    expect(matchScore('moonshotai/kimi-k2.6*', 'kimi-k2.6-20260420')).toBe(
      'kimi-k2.6*'.length,
    );
    expect(matchScore('moonshotai/kimi-k2.6*', 'moonshotai/kimi-k2.6-20260420')).toBe(
      2000 + 'moonshotai/kimi-k2.6*'.length,
    );
  });

  it('full match outranks slug match for the same model', () => {
    const full = matchScore('moonshotai/kimi-k2.6', 'moonshotai/kimi-k2.6');
    const slug = matchScore('moonshotai/kimi-k2.6', 'kimi-k2.6');
    expect(full).toBeGreaterThan(slug);
  });

  it('non-* key does not capture a more-specific model (isolation)', () => {
    expect(matchScore('gpt-4', 'gpt-4o')).toBe(-1);
    expect(matchScore('gpt-4', 'gpt-4-turbo')).toBe(-1);
  });

  it('slug tiers do not bridge two different vendor prefixes', () => {
    expect(matchScore('openai/gpt-4o', 'azure/gpt-4o')).toBe(-1);
    expect(matchScore('openai/gpt-4*', 'azure/gpt-4o')).toBe(-1);
  });
});

describe('detectSlugCollisions', () => {
  it('returns empty for undefined / empty overrides', () => {
    expect(detectSlugCollisions(undefined)).toEqual([]);
    expect(detectSlugCollisions({})).toEqual([]);
  });

  it('returns empty when all slugs are unique', () => {
    expect(
      detectSlugCollisions({ 'openai/gpt-4o': {}, 'anthropic/claude-4': {} }),
    ).toEqual([]);
  });

  it('groups same-slug vendor keys in declaration order', () => {
    expect(detectSlugCollisions({ 'openai/gpt-4o': {}, 'azure/gpt-4o': {} })).toEqual([
      {
        slug: 'gpt-4o',
        keys: ['openai/gpt-4o', 'azure/gpt-4o'],
        winner: 'openai/gpt-4o',
      },
    ]);
  });

  it('treats a bare key and a prefixed key with the same slug as a collision', () => {
    expect(detectSlugCollisions({ 'gpt-4o': {}, 'openai/gpt-4o': {} })).toEqual([
      { slug: 'gpt-4o', keys: ['gpt-4o', 'openai/gpt-4o'], winner: 'gpt-4o' },
    ]);
  });

  it('winner is the bare key even when it is not first-declared (full-exact beats slug)', () => {
    // Arrange — bare key wins on full-exact (3000+), so winner ≠ keys[0].
    const collisions = detectSlugCollisions({ 'openai/gpt-4o': {}, 'gpt-4o': {} });

    // Act & Assert
    expect(collisions[0]?.winner).toBe('gpt-4o');
    expect(collisions[0]?.winner).not.toBe(collisions[0]?.keys[0]);
  });

  it('does not collide on different slugs or * patterns', () => {
    expect(
      detectSlugCollisions({ 'moonshotai/kimi*': {}, 'moonshotai/kimi-k2.6': {} }),
    ).toEqual([]);
  });
});

describe('formatSlugCollisionWarning', () => {
  it('names both keys, the slug, and reports the actual winner', () => {
    // Arrange
    const msg = formatSlugCollisionWarning({
      slug: 'gpt-4o',
      keys: ['openai/gpt-4o', 'azure/gpt-4o'],
      winner: 'openai/gpt-4o',
    });

    // Act & Assert
    expect(msg).toContain('"openai/gpt-4o"');
    expect(msg).toContain('"azure/gpt-4o"');
    expect(msg).toContain('"gpt-4o"');
    expect(msg).toContain('a bare name resolves to "openai/gpt-4o"');
  });

  it('reports the bare key as winner regardless of declaration order', () => {
    // Arrange
    const msg = formatSlugCollisionWarning({
      slug: 'gpt-4o',
      keys: ['openai/gpt-4o', 'gpt-4o'],
      winner: 'gpt-4o',
    });

    // Act & Assert
    expect(msg).toContain('a bare name resolves to "gpt-4o"');
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
    rewriteBlockTtl: 'skip',
    normalizeResponses: 'auto',
    normalizeMessages: 'auto',
    normalizeVolatileSystem: false,
    observability: { ...DEFAULTS.observability },
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

  it('should override normalizeVolatileSystem from model override', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      normalizeVolatileSystem: false,
      modelOverrides: {
        'qwen-*': { normalizeVolatileSystem: true },
      },
    };
    const resolved = resolveModelConfig(config, 'qwen-plus');
    expect(resolved.normalizeVolatileSystem).toBe(true);
  });

  it('should inherit global normalizeVolatileSystem when override omits it', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      normalizeVolatileSystem: true,
      modelOverrides: {
        'qwen-*': { provider: { only: 'deepinfra' } },
      },
    };
    const resolved = resolveModelConfig(config, 'qwen-plus');
    expect(resolved.normalizeVolatileSystem).toBe(true);
  });

  it('records the matched override key (prefix-agnostic)', () => {
    const config = {
      ...baseConfig,
      modelOverrides: { 'moonshotai/kimi-k2.6': { provider: { only: 'baidu/fp4' } } },
    } as unknown as ProxyConfig;
    expect(resolveModelConfig(config, 'kimi-k2.6').matchedOverride).toBe(
      'moonshotai/kimi-k2.6',
    );
    expect(resolveModelConfig(config, 'unrelated-model').matchedOverride).toBeUndefined();
  });

  it('does not apply a vendor-prefixed override to a different vendor', () => {
    // Arrange
    const config = {
      ...baseConfig,
      modelOverrides: { 'openai/gpt-4o': { provider: { only: 'openai' } } },
    } as unknown as ProxyConfig;

    // Act
    const resolved = resolveModelConfig(config, 'azure/gpt-4o');

    // Assert — no match; provider stays at the global 'deepinfra', not 'openai'.
    expect(resolved.matchedOverride).toBeUndefined();
    expect(resolved.provider?.only).toBe('deepinfra');
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

describe('readConfigFileRaw', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'proxitor-raw-'));
    configPath = join(dir, 'proxitor.config.yaml');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves absent keys as undefined (does not apply schema defaults)', () => {
    writeFileSync(configPath, 'port: 8828\n');
    const raw = readConfigFileRaw(configPath);
    expect(raw.normalizeVolatileSystem).toBeUndefined();
    expect(raw.cacheControl).toBeUndefined();
    expect(raw.sessionId).toBeUndefined();
    // readConfigFile, by contrast, collapses absent → schema default:
    expect(readConfigFile(configPath).normalizeVolatileSystem).toBe(false);
    expect(readConfigFile(configPath).cacheControl).toBe('auto');
  });

  it('returns explicitly set values unchanged', () => {
    writeFileSync(configPath, 'normalizeVolatileSystem: true\ncacheControl: always\n');
    const raw = readConfigFileRaw(configPath);
    expect(raw.normalizeVolatileSystem).toBe(true);
    expect(raw.cacheControl).toBe('always');
  });

  it('still rejects invalid configs with ConfigValidationError', () => {
    writeFileSync(configPath, 'normalizeVolatileSystem: "not-a-bool"\n');
    expect(() => readConfigFileRaw(configPath)).toThrow(ConfigValidationError);
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
    rewriteBlockTtl: 'skip',
    normalizeResponses: 'auto',
    normalizeMessages: 'auto',
    normalizeVolatileSystem: false,
    observability: { ...DEFAULTS.observability },
  };

  it('accepts cacheControl: auto', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'auto' });
    expect(result.success).toBe(true);
  });

  it('accepts cacheControl: always', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'always' });
    expect(result.success).toBe(true);
  });

  it('accepts cacheControl: skip', () => {
    const result = proxyConfigFileSchema.safeParse({ cacheControl: 'skip' });
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
    const config = await loadConfig({ noConfig: true, openrouterKey: 'test-key' });
    expect(config.cacheControl).toBe('auto');
  });

  it('defaults sessionId to auto', async () => {
    const config = await loadConfig({ noConfig: true, openrouterKey: 'test-key' });
    expect(config.sessionId).toBe('auto');
  });

  it('allows per-model cacheControl override', () => {
    const config: ProxyConfig = {
      ...baseConfig,
      cacheControl: 'auto',
      modelOverrides: {
        'gpt-*': { cacheControl: 'skip' },
      },
    };
    const resolved = resolveModelConfig(config, 'gpt-4o');
    expect(resolved.cacheControl).toBe('skip');
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

  describe('cacheControlTtl', () => {
    it('accepts cacheControlTtl: 5m in global config', () => {
      const result = proxyConfigFileSchema.safeParse({ cacheControlTtl: '5m' });
      expect(result.success).toBe(true);
    });

    it('accepts cacheControlTtl: 1h in global config', () => {
      const result = proxyConfigFileSchema.safeParse({ cacheControlTtl: '1h' });
      expect(result.success).toBe(true);
    });

    it('accepts cacheControlTtl: omit in global config', () => {
      const result = proxyConfigFileSchema.safeParse({ cacheControlTtl: 'omit' });
      expect(result.success).toBe(true);
    });

    it('accepts cacheControlTtl: skip in global config', () => {
      const result = proxyConfigFileSchema.safeParse({ cacheControlTtl: 'skip' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid cacheControlTtl in global config', () => {
      const result = proxyConfigFileSchema.safeParse({ cacheControlTtl: '10m' });
      expect(result.success).toBe(false);
    });

    it('rejects cacheControlTtl: null in global config', () => {
      const result = proxyConfigFileSchema.safeParse({ cacheControlTtl: null });
      expect(result.success).toBe(false);
    });

    it('defaults cacheControlTtl to undefined', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
      const configPath = join(dir, 'proxitor.config.yaml');
      writeFileSync(configPath, 'openrouterKey: test-key');
      try {
        const config = await loadConfig({ configPath, openrouterKey: 'test-key' });
        expect(config.cacheControlTtl).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('accepts cacheControlTtl: omit in model override', () => {
      const result = proxyConfigFileSchema.safeParse({
        modelOverrides: { 'gpt-*': { cacheControlTtl: 'omit' } },
      });
      expect(result.success).toBe(true);
    });

    it('accepts cacheControlTtl: skip in model override', () => {
      const result = proxyConfigFileSchema.safeParse({
        modelOverrides: { 'gpt-*': { cacheControlTtl: 'skip' } },
      });
      expect(result.success).toBe(true);
    });

    it('accepts cacheControlTtl: 1h in model override', () => {
      const result = proxyConfigFileSchema.safeParse({
        modelOverrides: { 'gpt-*': { cacheControlTtl: '1h' } },
      });
      expect(result.success).toBe(true);
    });

    it('rejects cacheControlTtl: null in model override', () => {
      const result = proxyConfigFileSchema.safeParse({
        modelOverrides: { 'gpt-*': { cacheControlTtl: null } },
      });
      expect(result.success).toBe(false);
    });

    it('propagates global cacheControlTtl to resolved config', () => {
      const config: ProxyConfig = { ...baseConfig, cacheControlTtl: '1h' };
      const resolved = resolveModelConfig(config, 'gpt-4o');
      expect(resolved.cacheControlTtl).toBe('1h');
    });

    it('allows per-model cacheControlTtl override', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        cacheControlTtl: '1h',
        modelOverrides: {
          'claude-*': { cacheControlTtl: '5m' },
        },
      };
      const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
      expect(resolved.cacheControlTtl).toBe('5m');
    });

    it('inherits global cacheControlTtl when override is absent', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        cacheControlTtl: '1h',
        modelOverrides: {
          'claude-*': { cacheControl: 'always' },
        },
      };
      const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
      expect(resolved.cacheControlTtl).toBe('1h');
    });

    it('carries per-model skip override through resolution (no normalization)', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        cacheControlTtl: '1h',
        modelOverrides: {
          'gpt-*': { cacheControlTtl: 'skip' },
        },
      };
      const resolved = resolveModelConfig(config, 'gpt-4o');
      expect(resolved.cacheControlTtl).toBe('skip');
    });

    it('carries per-model omit override through resolution (no normalization)', () => {
      const config: ProxyConfig = {
        ...baseConfig,
        cacheControlTtl: '1h',
        modelOverrides: {
          'gpt-*': { cacheControlTtl: 'omit' },
        },
      };
      const resolved = resolveModelConfig(config, 'gpt-4o');
      expect(resolved.cacheControlTtl).toBe('omit');
    });

    it('propagates global skip cacheControlTtl to resolved config', () => {
      const config: ProxyConfig = { ...baseConfig, cacheControlTtl: 'skip' };
      const resolved = resolveModelConfig(config, 'gpt-4o');
      expect(resolved.cacheControlTtl).toBe('skip');
    });
  });
});

describe('throwIfV1Suffix (via loadConfig)', () => {
  it('should throw when openrouterBaseUrl ends with /v1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'openrouterBaseUrl: "https://openrouter.ai/api/v1"');
    try {
      await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
        'ends with /v1',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should throw when openrouterBaseUrl ends with /v1/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'openrouterBaseUrl: "https://openrouter.ai/api/v1/"');
    try {
      await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
        'ends with /v1',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should suggest the corrected URL without /v1 suffix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'openrouterBaseUrl: "https://openrouter.ai/api/v1"');
    try {
      await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
        'https://openrouter.ai/api',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should accept URL without /v1 suffix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'openrouterBaseUrl: "https://openrouter.ai/api"');
    try {
      const config = await loadConfig({ configPath, openrouterKey: 'test-key' });
      expect(config.openrouterBaseUrl).toBe('https://openrouter.ai/api');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should throw when openrouterDataUrl ends with /v1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxitor-test-'));
    const configPath = join(dir, 'proxitor.config.yaml');
    writeFileSync(configPath, 'openrouterDataUrl: "https://openrouter.ai/api/v1"');
    try {
      await expect(loadConfig({ configPath, openrouterKey: 'test-key' })).rejects.toThrow(
        'ends with /v1',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rewriteBlockTtl', () => {
  it('defaults to "skip" globally', () => {
    expect(DEFAULTS.rewriteBlockTtl).toBe('skip');
  });

  it('is resolved from global config', () => {
    const resolved = resolveModelConfig(
      { ...DEFAULTS, rewriteBlockTtl: 'always' } satisfies ProxyConfig,
      undefined,
    );
    expect(resolved.rewriteBlockTtl).toBe('always');
  });

  it('per-model override wins over global', () => {
    const config = {
      ...DEFAULTS,
      rewriteBlockTtl: 'skip',
      modelOverrides: { 'claude-*': { rewriteBlockTtl: 'auto' } },
    } satisfies ProxyConfig;
    const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
    expect(resolved.rewriteBlockTtl).toBe('auto');
  });

  it('inherits global when per-model is absent', () => {
    const config = {
      ...DEFAULTS,
      rewriteBlockTtl: 'always',
      modelOverrides: { 'claude-*': { cacheControl: 'skip' } },
    } satisfies ProxyConfig;
    const resolved = resolveModelConfig(config, 'claude-sonnet-4-6');
    expect(resolved.rewriteBlockTtl).toBe('always');
  });

  it('rejects an invalid rewriteBlockTtl value', () => {
    const result = proxyConfigFileSchema.safeParse({ rewriteBlockTtl: 'sometimes' });
    expect(result.success).toBe(false);
  });
});
