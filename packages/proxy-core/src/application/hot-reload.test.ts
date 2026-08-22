import type { LoggerPort } from '@proxitor/plugin-api';
import { describe, expect, test, vi } from 'vitest';
import type { RoutingTable } from '../domain/index.js';
import type { ProxyConfig } from './config-schema.js';
import {
  createHotReload,
  createRuntimeSwap,
  type HotReloadDeps,
  type RuntimeState,
  summarizeConfigDiff,
} from './hot-reload.js';

// Test fakes
const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

const createFakeRoutingTable = (id: string): RoutingTable => ({
  resolve: vi.fn(),
  resolveModelLess: vi.fn(),
  listModels: vi.fn(() => [`model-${id}`]),
});

const createFakeConfig = (overrides = {}): ProxyConfig => ({
  version: 1,
  providers: {
    openai: {
      id: 'openai',
      baseUrl: 'https://api.openai.com',
      wireFormat: 'openai-chat',
      auth: { type: 'bearer', credential: 'sk-test' },
    },
  },
  models: [{ match: 'gpt-*', provider: 'openai', modelId: 'gpt-4' }],
  observability: {
    routerMetadata: true,
    hitThreshold: 80,
    sideMaxTokens: 4096,
    sessionMaxEntries: 4096,
    sessionTtlMs: 600000,
  },
  server: {
    host: '127.0.0.1',
    port: 8828,
    bodyLimitBytes: 52428800,
    forwardHeaders: [],
  },
  logging: { verbose: false },
  ...overrides,
});

describe('createRuntimeSwap', () => {
  test('facade delegates to current table and stays identity-stable across swap', () => {
    // Arrange
    const table1 = createFakeRoutingTable('1');
    const table2 = createFakeRoutingTable('2');
    const state1: RuntimeState = { config: createFakeConfig(), table: table1 };
    const state2: RuntimeState = { config: createFakeConfig(), table: table2 };
    const swap = createRuntimeSwap(state1);

    // Act - facade should be identity-stable
    const facade1 = swap.table;
    swap.swap(state2);
    const facade2 = swap.table;

    // Assert - same object reference across swap
    expect(facade1).toBe(facade2);
    expect(facade1).toBe(swap.table);

    // But resolve now hits the new table
    const listResult = swap.table.listModels();
    expect(listResult).toEqual(['model-2']);
  });

  test('inflight requests are unaffected - they hold captured RouteResolution values', () => {
    // Arrange
    const table1 = createFakeRoutingTable('1');
    const table2 = createFakeRoutingTable('2');
    const state1: RuntimeState = { config: createFakeConfig(), table: table1 };
    const state2: RuntimeState = { config: createFakeConfig(), table: table2 };
    const swap = createRuntimeSwap(state1);

    // Act - facade is identity-stable, but delegates to current.table
    const facade1 = swap.table;
    swap.swap(state2);
    const facade2 = swap.table;

    // Assert - same object reference across swaps (facade is stable)
    expect(facade1).toBe(facade2);

    // But calling methods through the facade hits the new current table
    // (inflight requests hold RouteResolution values, not the table itself)
    const listResult = swap.table.listModels();
    expect(listResult).toEqual(['model-2']);
  });
});

describe('summarizeConfigDiff', () => {
  test('unchanged configs returns empty string', () => {
    const config = createFakeConfig();
    expect(summarizeConfigDiff(config, config)).toBe('');
  });

  test('added provider surfaces as +id', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      providers: {
        ...config1.providers,
        anthropic: {
          id: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
      },
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('+anthropic');
  });

  test('removed provider surfaces as -id', () => {
    const config1 = createFakeConfig({
      providers: {
        openai: {
          id: 'openai',
          baseUrl: 'https://api.openai.com',
          wireFormat: 'openai-chat',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
        anthropic: {
          id: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
      },
    });
    const config2 = createFakeConfig();
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('-anthropic');
  });

  test('changed provider surfaces as id (changed)', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      providers: {
        openai: {
          ...config1.providers.openai!,
          baseUrl: 'https://api.openai2.com',
        },
      },
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('openai (changed)');
  });

  test('added model surfaces as +match', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      models: [
        ...config1.models,
        { match: 'claude-*', provider: 'openai', modelId: 'claude-3' },
      ],
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('+claude-*');
  });

  test('removed model surfaces as -match', () => {
    const config1 = createFakeConfig({
      models: [
        { match: 'gpt-*', provider: 'openai', modelId: 'gpt-4' },
        { match: 'claude-*', provider: 'openai', modelId: 'claude-3' },
      ],
    });
    const config2 = createFakeConfig();
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('-claude-*');
  });

  test('changed model surfaces as match (provider/modelId changed)', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      models: [{ match: 'gpt-*', provider: 'openai', modelId: 'gpt-4-turbo' }],
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('gpt-* (changed)');
  });

  test('observability change surfaces', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      observability: { ...config1.observability, hitThreshold: 90 },
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toContain('observability');
  });

  test('server keys are NOT in diff (restart-warning only)', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      server: { ...config1.server, port: 9000 },
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toBe('');
  });

  test('same provider content with reordered keys returns empty diff (canonical comparison)', () => {
    const config1 = createFakeConfig();
    const config2 = createFakeConfig({
      providers: {
        ...config1.providers,
        openai: {
          wireFormat: 'openai-chat',
          auth: { type: 'bearer', credential: 'sk-test' },
          baseUrl: 'https://api.openai.com',
          id: 'openai',
        },
      },
    });
    const diff = summarizeConfigDiff(config1, config2);
    expect(diff).toBe('');
  });
});

describe('createHotReload', () => {
  test('reload success: swap called with new state, reconfigure received new config, result ok true', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextTable = createFakeRoutingTable('next');
    const nextConfig = createFakeConfig({
      providers: {
        ...initialConfig.providers,
        anthropic: {
          id: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
      },
    });

    const reconfigureSpy = vi.fn();
    const logger: LoggerPort = { ...silent, warn: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => nextTable,
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: reconfigureSpy,
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changes).toContain('+anthropic');
    }
    expect(hotReload.swap.current.config).toBe(nextConfig);
    expect(reconfigureSpy).toHaveBeenCalledWith(nextConfig);
  });

  test('buildTable throws -> ok false, swap NOT called, previous current intact (keep-last-valid)', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig();
    const logger: LoggerPort = { ...silent, error: vi.fn() };

    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => {
        throw new Error('buildTable failed');
      },
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('buildTable failed');
    }
    expect(hotReload.swap.current).toBe(initial);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('config reload failed'),
      expect.any(Object),
    );
  });

  test('preloadCredentials throws -> ok false, swap NOT called', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig();
    const logger: LoggerPort = { ...silent, error: vi.fn() };

    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: async () => {
        throw new Error('preload failed');
      },
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('preload failed');
    }
    expect(hotReload.swap.current).toBe(initial);
  });

  test('validate throws -> ok false, swap NOT called', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig();
    const logger: LoggerPort = { ...silent, error: vi.fn() };

    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: () => {
        throw new Error('validation failed');
      },
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('validation failed');
    }
    expect(hotReload.swap.current).toBe(initial);
  });

  test('readNext throws -> ok false, swap NOT called', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const logger: LoggerPort = { ...silent, error: vi.fn() };

    const deps: HotReloadDeps = {
      readNext: async () => {
        throw new Error('read failed');
      },
      buildTable: vi.fn(),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('read failed');
    }
    expect(hotReload.swap.current).toBe(initial);
  });

  test('concurrent reload coalesces - one readNext call, coalesced second returns ok true', async () => {
    // Arrange
    let readNextCallCount = 0;
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      providers: {
        ...initialConfig.providers,
        anthropic: {
          id: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
      },
    });

    const logger: LoggerPort = silent;
    const deps: HotReloadDeps = {
      readNext: async () => {
        readNextCallCount++;
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async work
        return nextConfig;
      },
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act - start two concurrent reloads
    const result1Promise = hotReload.reload();
    const result2Promise = hotReload.reload();

    const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

    // Assert - only one readNext call
    expect(readNextCallCount).toBe(1);
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.changes).toContain('reload already in progress');
    }
  });

  test('restart-keys change -> warn logged with exact message, reload still succeeds', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      server: { ...initialConfig.server, port: 9000 },
    });

    const logger: LoggerPort = { ...silent, warn: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'host/port/bodyLimit/forwardHeaders changed — restart proxitor to apply (live reload does not re-bind the socket or body parser)',
    );
  });

  test('server.host change triggers restart warning', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      server: { ...initialConfig.server, host: '0.0.0.0' },
    });

    const logger: LoggerPort = { ...silent, warn: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    await hotReload.reload();

    // Assert
    expect(logger.warn).toHaveBeenCalledWith(
      'host/port/bodyLimit/forwardHeaders changed — restart proxitor to apply (live reload does not re-bind the socket or body parser)',
    );
  });

  test('server.bodyLimitBytes change triggers restart warning', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      server: { ...initialConfig.server, bodyLimitBytes: 104857600 },
    });

    const logger: LoggerPort = { ...silent, warn: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    await hotReload.reload();

    // Assert
    expect(logger.warn).toHaveBeenCalledWith(
      'host/port/bodyLimit/forwardHeaders changed — restart proxitor to apply (live reload does not re-bind the socket or body parser)',
    );
  });

  test('server.forwardHeaders change triggers restart warning', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      server: { ...initialConfig.server, forwardHeaders: ['X-Custom-Header'] },
    });

    const logger: LoggerPort = { ...silent, warn: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    await hotReload.reload();

    // Assert
    expect(logger.warn).toHaveBeenCalledWith(
      'host/port/bodyLimit/forwardHeaders changed — restart proxitor to apply (live reload does not re-bind the socket or body parser)',
    );
  });

  test('info log on successful reload with changes', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      providers: {
        ...initialConfig.providers,
        anthropic: {
          id: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
      },
    });

    const logger: LoggerPort = { ...silent, info: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: vi.fn(),
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(logger.info).toHaveBeenCalledWith(`config reloaded — ${result.changes}`);
    }
  });

  test('reconfigure throws -> result ok true, swap happened, warn logged', async () => {
    // Arrange
    const initialTable = createFakeRoutingTable('initial');
    const initialConfig = createFakeConfig();
    const initial: RuntimeState = { config: initialConfig, table: initialTable };

    const nextConfig = createFakeConfig({
      providers: {
        ...initialConfig.providers,
        anthropic: {
          id: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'bearer', credential: 'sk-test' },
        },
      },
    });

    const logger: LoggerPort = { ...silent, warn: vi.fn() };
    const deps: HotReloadDeps = {
      readNext: async () => nextConfig,
      buildTable: () => createFakeRoutingTable('next'),
      validate: vi.fn(),
      preloadCredentials: vi.fn(),
      reconfigure: () => {
        throw new Error('reconfigure failed');
      },
      logger,
    };

    const hotReload = createHotReload({ initial, deps });

    // Act
    const result = await hotReload.reload();

    // Assert
    expect(result.ok).toBe(true);
    expect(hotReload.swap.current.config).toBe(nextConfig);
    expect(logger.warn).toHaveBeenCalledWith(
      'config reloaded but reconfigure failed: reconfigure failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});
