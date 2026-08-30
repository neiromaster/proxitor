import { describe, expect, test } from 'vitest';
import { RoutingConfigError } from '../domain/index.js';
import { createBuiltInPluginRegistry } from '../plugins/built-in/index.js';
import { validateActivation } from './activation-check.js';
import { parseConfig } from './config-schema.js';
import { createPluginManager } from './plugin-manager.js';

const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

const CONFIG_TEXT = {
  version: 1,
  providers: {
    oai: {
      baseUrl: 'https://oai.example.com',
      wireFormat: 'openai-chat',
      auth: { type: 'bearer', credential: 'k' },
      plugins: [{ 'openrouter-routing': { only: ['anthropic'] } }],
    },
    ant: {
      baseUrl: 'https://ant.example.com',
      wireFormat: 'anthropic-messages',
      auth: { type: 'bearer', credential: 'k' },
      headers: { 'anthropic-version': '2023-06-01' },
    },
  },
  models: [
    { match: 'gpt-*', provider: 'oai', modelId: '$MODEL' },
    { match: 'claude-*', provider: 'ant', modelId: '$MODEL' },
  ],
};

describe('validateActivation', () => {
  test('activates every binding and the model-less route at load', () => {
    // Arrange
    const config = parseConfig(CONFIG_TEXT);
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger: silent,
    });
    // Act + Assert — openrouter-routing declares openai-chat-only reservedKeys; provider is openai-chat → passes
    expect(() => validateActivation(config, manager)).not.toThrow();
  });

  test('global openrouter-routing loads mixed formats: warn on anthropic, active on openai (B5.2)', () => {
    // Arrange
    const config = parseConfig({
      ...CONFIG_TEXT,
      plugins: [{ 'openrouter-routing': { only: ['anthropic'] } }],
    });
    const warns: Array<{ message: string; context?: unknown }> = [];
    const logger = {
      info() {},
      warn(message: string, context?: unknown) {
        warns.push({ message, context });
      },
      error() {},
      debug() {},
    };
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger,
    });

    // Act
    expect(() => validateActivation(config, manager, logger)).not.toThrow();

    // Assert — exactly one warn, for the anthropic-messages route only
    expect(warns).toHaveLength(1);
    expect(warns[0]?.message).toContain('openrouter-routing');
    expect(warns[0]?.message).toContain('anthropic-messages');
    expect(warns[0]?.message).toContain('skipped');
    expect(warns[0]?.context).toMatchObject({ plugin: 'openrouter-routing' });
    // the openai-chat route still activates the plugin
    const active = manager.activate([{ name: 'openrouter-routing' }], 'openai-chat');
    expect(active).toHaveLength(1);
  });

  test('defaultProvider route is validated too', () => {
    const config = parseConfig({ ...CONFIG_TEXT, defaultProvider: 'ant' });
    const configBad = parseConfig({
      ...CONFIG_TEXT,
      defaultProvider: 'ant',
      providers: {
        ...CONFIG_TEXT.providers,
        ant: {
          ...CONFIG_TEXT.providers.ant!,
          plugins: [{ 'no-such-plugin': {} }],
        },
      },
    });
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger: silent,
    });
    expect(() => validateActivation(config, manager)).not.toThrow();
    expect(() => validateActivation(configBad, manager)).toThrow(RoutingConfigError);
    expect(() => validateActivation(configBad, manager)).toThrow(/no-such-plugin/);
  });

  test('an unknown plugin name still fails at load (B5.2 keeps this fatal)', () => {
    // Arrange
    const config = parseConfig({
      ...CONFIG_TEXT,
      plugins: ['no-such-plugin'],
    });
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger: silent,
    });

    // Act + Assert
    expect(() => validateActivation(config, manager)).toThrow(RoutingConfigError);
    expect(() => validateActivation(config, manager)).toThrow(
      /unknown plugin "no-such-plugin"/,
    );
  });
});
