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

  test('a format-incompatible binding fails at load (D7: no request-time 500)', () => {
    const config = parseConfig({
      ...CONFIG_TEXT,
      models: [
        {
          match: 'claude-*',
          provider: 'ant',
          modelId: '$MODEL',
          plugins: [{ 'openrouter-routing': { only: ['anthropic'] } }],
        },
      ],
    });
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger: silent,
    });
    expect(() => validateActivation(config, manager)).toThrow(RoutingConfigError);
  });

  test('defaultProvider route is validated too', () => {
    const config = parseConfig({ ...CONFIG_TEXT, defaultProvider: 'ant' });
    const configBad = parseConfig({
      ...CONFIG_TEXT,
      defaultProvider: 'oai',
      providers: {
        ...CONFIG_TEXT.providers,
        oai: {
          ...CONFIG_TEXT.providers.oai!,
          wireFormat: 'anthropic-messages',
          headers: { 'anthropic-version': '2023-06-01' },
        },
      },
    });
    const manager = createPluginManager({
      plugins: createBuiltInPluginRegistry(),
      logger: silent,
    });
    expect(() => validateActivation(config, manager)).not.toThrow();
    expect(() => validateActivation(configBad, manager)).toThrow(RoutingConfigError);
  });
});
