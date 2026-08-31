import { MODELS_PATH } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import { RoutingConfigError, RoutingError } from './error.js';
import type { PluginListEntry } from './plugin-merge.js';
import type { ProviderConfig } from './provider.js';
import { classifyPath, createRoutingTable, type RoutingConfig } from './routing.js';

function anthropicProvider(): ProviderConfig {
  return {
    id: 'anthropic-direct',
    baseUrl: 'https://api.anthropic.com',
    wireFormat: 'anthropic-messages',
    auth: { type: 'x-api-key', credential: { env: 'ANTHROPIC_API_KEY' } },
    headers: { 'anthropic-version': '2023-06-01' },
  };
}

function openaiProvider(): ProviderConfig {
  return {
    id: 'openai-prod',
    baseUrl: 'https://api.openai.com',
    wireFormat: 'openai-chat',
    auth: { type: 'bearer', credential: { env: 'OPENAI_API_KEY' } },
  };
}

function openrouterProvider(): ProviderConfig {
  return {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api',
    wireFormat: 'openai-chat',
    auth: { type: 'bearer', credential: { env: 'OPENROUTER_API_KEY' } },
    plugins: [{ 'openrouter-routing': { only: ['anthropic'], order: ['anthropic'] } }],
  };
}

function specConfig(overrides: Partial<RoutingConfig> = {}): RoutingConfig {
  return {
    providers: {
      'openai-prod': openaiProvider(),
      'anthropic-direct': anthropicProvider(),
      openrouter: openrouterProvider(),
    },
    models: [
      { match: 'claude-opus*', provider: 'anthropic-direct', modelId: 'claude-opus-4-1' },
      {
        match: 'claude-sonnet*',
        provider: 'anthropic-direct',
        modelId: 'claude-sonnet-4-5-20250929',
        plugins: [{ 'cache-control': false }],
      },
      { match: 'gpt-5', provider: 'openai-prod', modelId: 'gpt-5' },
      { match: '*', provider: 'openrouter', modelId: '$MODEL' },
    ],
    plugins: [
      'normalize-volatile-system',
      { 'cache-control': { cacheControl: 'auto', rewriteBlockTtl: 'auto' } },
      { 'session-id': { mode: 'auto' } },
    ],
    defaultProvider: 'openrouter',
    ...overrides,
  };
}

describe('classifyPath', () => {
  test('maps the two LLM endpoints to their wire formats', () => {
    // Arrange / Act / Assert
    expect(classifyPath('/v1/messages')).toBe('anthropic-messages');
    expect(classifyPath('/v1/chat/completions')).toBe('openai-chat');
  });

  test('returns the models sentinel for /v1/models', () => {
    // Arrange / Act / Assert
    expect(classifyPath(MODELS_PATH)).toBe(MODELS_PATH);
  });

  test('501 for the deferred openai-responses endpoint (§17)', () => {
    // Arrange / Act / Assert
    expect(() => classifyPath('/v1/responses')).toThrow(RoutingError);
    expect(() => classifyPath('/v1/responses')).toThrow(/deferred/);
    try {
      classifyPath('/v1/responses');
    } catch (error) {
      expect((error as RoutingError).status).toBe(501);
    }
  });

  test('404 for unknown paths', () => {
    // Arrange / Act / Assert
    try {
      classifyPath('/v1/nope');
      expect.unreachable('classifyPath must throw');
    } catch (error) {
      expect((error as RoutingError).status).toBe(404);
    }
  });
});

describe('createRoutingTable + resolve', () => {
  test('top-down first-match-wins with case-insensitive glob', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const resolution = table.resolve('Claude-Opus-4-1', '/v1/messages');

    // Assert
    expect(resolution.provider.id).toBe('anthropic-direct');
    expect(resolution.physicalModel).toBe('claude-opus-4-1');
    expect(resolution.inboundFormat).toBe('anthropic-messages');
    expect(resolution.outboundFormat).toBe('anthropic-messages');
  });

  test('exact binding wins over the star fallback', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const resolution = table.resolve('gpt-5', '/v1/chat/completions');

    // Assert
    expect(resolution.provider.id).toBe('openai-prod');
    expect(resolution.inboundFormat).toBe('openai-chat');
    expect(resolution.outboundFormat).toBe('openai-chat');
  });

  test('$MODEL passes the logical name through; inbound≠outbound bridges via IR', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const resolution = table.resolve('qwen-3-max', '/v1/messages');

    // Assert
    expect(resolution.provider.id).toBe('openrouter');
    expect(resolution.physicalModel).toBe('qwen-3-max');
    expect(resolution.inboundFormat).toBe('anthropic-messages');
    expect(resolution.outboundFormat).toBe('openai-chat');
  });

  test('plugins merge across all three layers (global + provider + binding)', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const resolution = table.resolve('qwen-3-max', '/v1/chat/completions');

    // Assert
    expect(resolution.plugins).toEqual([
      { name: 'normalize-volatile-system' },
      {
        name: 'cache-control',
        config: { cacheControl: 'auto', rewriteBlockTtl: 'auto' },
      },
      { name: 'session-id', config: { mode: 'auto' } },
      {
        name: 'openrouter-routing',
        config: { only: ['anthropic'], order: ['anthropic'] },
      },
    ]);
  });

  test('binding-layer disable removes an inherited plugin', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const resolution = table.resolve('claude-sonnet-4-5', '/v1/messages');

    // Assert
    expect(resolution.plugins.some(plugin => plugin.name === 'cache-control')).toBe(
      false,
    );
    expect(resolution.plugins.map(plugin => plugin.name)).toEqual([
      'normalize-volatile-system',
      'session-id',
    ]);
  });

  test('400 "no binding" when nothing matches and no fallback exists', () => {
    // Arrange
    const table = createRoutingTable(
      specConfig({
        models: [{ match: 'gpt-5', provider: 'openai-prod', modelId: 'gpt-5' }],
      }),
    );

    // Act / Assert
    try {
      table.resolve('claude-opus-4-1', '/v1/messages');
      expect.unreachable('resolve must throw');
    } catch (error) {
      expect((error as RoutingError).status).toBe(400);
      expect((error as RoutingError).message).toContain('claude-opus-4-1');
    }
  });

  test('resolve on /v1/models is a 404 pointing at listModels', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act / Assert
    try {
      table.resolve('gpt-5', MODELS_PATH);
      expect.unreachable('resolve must throw');
    } catch (error) {
      expect((error as RoutingError).status).toBe(404);
    }
  });
});

describe('createRoutingTable + resolveModelLess', () => {
  test('routes to defaultProvider without formats or physical model', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const resolution = table.resolveModelLess('/v1/embeddings');

    // Assert
    expect(resolution.provider.id).toBe('openrouter');
    expect(resolution.physicalModel).toBeUndefined();
    expect(resolution.inboundFormat).toBeUndefined();
    expect(resolution.outboundFormat).toBe('openai-chat');
    expect(resolution.plugins.map(plugin => plugin.name)).toEqual([
      'normalize-volatile-system',
      'cache-control',
      'session-id',
      'openrouter-routing',
    ]);
  });

  test('404 when no defaultProvider is configured', () => {
    // Arrange
    const table = createRoutingTable(specConfig({ defaultProvider: undefined }));

    // Act / Assert
    try {
      table.resolveModelLess('/v1/embeddings');
      expect.unreachable('resolveModelLess must throw');
    } catch (error) {
      expect((error as RoutingError).status).toBe(404);
    }
  });
});

describe('createRoutingTable + listModels', () => {
  test('distinct match patterns in table order', () => {
    // Arrange
    const table = createRoutingTable(specConfig());

    // Act
    const models = table.listModels();

    // Assert
    expect(models).toEqual(['claude-opus*', 'claude-sonnet*', 'gpt-5', '*']);
  });
});

describe('createRoutingTable validation', () => {
  test('providers key must match the declared id', () => {
    // Arrange
    const mismatched = specConfig({
      providers: { wrong: openaiProvider() },
    });

    // Act / Assert
    expect(() => createRoutingTable(mismatched)).toThrow(RoutingConfigError);
    expect(() => createRoutingTable(mismatched)).toThrow(/id mismatch/);
  });

  test('binding referencing an unknown provider is rejected', () => {
    // Arrange
    const dangling = specConfig({
      models: [{ match: 'gpt-5', provider: 'nope', modelId: 'gpt-5' }],
    });

    // Act / Assert
    expect(() => createRoutingTable(dangling)).toThrow(/unknown provider "nope"/);
  });

  test('invalid provider config (baseUrl /v1) surfaces at build time', () => {
    // Arrange
    const invalid = specConfig({
      providers: {
        'openai-prod': { ...openaiProvider(), baseUrl: 'https://api.openai.com/v1' },
      },
      models: [],
    });

    // Act / Assert
    expect(() => createRoutingTable(invalid)).toThrow(/ends with \/v1/);
  });

  test('empty match glob is rejected', () => {
    // Arrange
    const empty = specConfig({
      models: [{ match: '', provider: 'openai-prod', modelId: 'gpt-5' }],
    });

    // Act / Assert
    expect(() => createRoutingTable(empty)).toThrow(/match/);
  });

  test('defaultProvider must exist in providers', () => {
    // Arrange
    const dangling = specConfig({ defaultProvider: 'ghost' });

    // Act / Assert
    expect(() => createRoutingTable(dangling)).toThrow(/defaultProvider/);
  });

  test('rejects empty object plugin entry at binding level', () => {
    // Arrange
    const invalidBinding = specConfig({
      models: [
        {
          match: 'gpt-5',
          provider: 'openai-prod',
          modelId: 'gpt-5',
          plugins: [{}] as PluginListEntry[],
        },
      ],
    });

    // Act / Assert
    expect(() => createRoutingTable(invalidBinding)).toThrow(RoutingConfigError);
    expect(() => createRoutingTable(invalidBinding)).toThrow(
      /plugin list entry must have exactly one key/,
    );
  });

  test('rejects multi-key plugin entry at provider level', () => {
    // Arrange
    const multiKeyProvider = specConfig({
      providers: {
        'openai-prod': {
          ...openaiProvider(),
          plugins: [
            { 'cache-control': {}, 'other-key': {} },
          ] as unknown as PluginListEntry[],
        },
        'anthropic-direct': anthropicProvider(),
        openrouter: openrouterProvider(),
      },
      models: [{ match: 'gpt-5', provider: 'openai-prod', modelId: 'gpt-5' }],
    });

    // Act / Assert
    expect(() => createRoutingTable(multiKeyProvider)).toThrow(RoutingConfigError);
    expect(() => createRoutingTable(multiKeyProvider)).toThrow(
      /plugin list entry must have exactly one key/,
    );
  });

  test('accepts the documented { disable: [name] } entry form at provider and model layers', () => {
    // Arrange
    const base = specConfig();
    const config = specConfig({
      providers: {
        ...base.providers,
        'openai-prod': {
          ...openaiProvider(),
          plugins: [{ disable: ['cache-control'] }],
        },
      },
      models: [
        {
          match: 'gpt-5',
          provider: 'openai-prod',
          modelId: 'gpt-5',
          plugins: [{ disable: ['session-id'] }],
        },
      ],
    });

    // Act
    const table = createRoutingTable(config);
    const resolution = table.resolve('gpt-5', '/v1/chat/completions');

    // Assert — only the never-disabled global survives the dry-run merge
    expect(resolution.plugins).toEqual([{ name: 'normalize-volatile-system' }]);
  });
});
