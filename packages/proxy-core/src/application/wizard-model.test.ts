// src/application/wizard-model.test.ts
import { ConfigError } from './config-schema.js';
import {
  buildWizardConfig,
  type WizardAnswers,
  wizardConfigObject,
} from './wizard-model.js';

const answers: WizardAnswers = {
  providers: [
    {
      name: 'openai',
      wireFormat: 'openai-chat',
      baseUrl: 'https://api.openai.com',
      authType: 'bearer',
      envVar: 'OPENAI_API_KEY',
    },
    {
      name: 'anthropic',
      wireFormat: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
      authType: 'x-api-key',
      envVar: 'ANTHROPIC_API_KEY',
    },
  ],
  models: [
    { match: 'gpt-5', provider: 'openai', modelId: 'gpt-5' },
    { match: 'claude-*', provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
    { match: '*', provider: 'openai', modelId: '$MODEL' },
  ],
  defaultProvider: 'openai',
  host: '127.0.0.1',
  port: 8828,
};

describe('wizard model', () => {
  it('maps answers to a minimal config object', () => {
    const object = wizardConfigObject(answers);
    expect(object).toEqual({
      version: 1,
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com',
          wireFormat: 'openai-chat',
          auth: { type: 'bearer', credential: { env: 'OPENAI_API_KEY' } },
        },
        anthropic: {
          baseUrl: 'https://api.anthropic.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'x-api-key', credential: { env: 'ANTHROPIC_API_KEY' } },
        },
      },
      models: answers.models,
      defaultProvider: 'openai',
      server: { host: '127.0.0.1', port: 8828 },
    });
  });

  it('round-trips answers through parseConfig into a valid ProxyConfig', () => {
    const config = buildWizardConfig(answers);
    expect(config.providers.openai?.auth).toEqual({
      type: 'bearer',
      credential: { env: 'OPENAI_API_KEY' },
    });
    expect(config.models).toHaveLength(3);
    expect(config.models[2]?.modelId).toBe('$MODEL');
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.server.port).toBe(8828);
  });

  it('rejects an empty provider list (schema minItems)', () => {
    expect(() => buildWizardConfig({ ...answers, providers: [] })).toThrow(ConfigError);
  });

  it('rejects an empty model list (schema minItems)', () => {
    expect(() => buildWizardConfig({ ...answers, models: [] })).toThrow(ConfigError);
  });

  it('rejects an invalid wire format', () => {
    const bad = {
      ...answers,
      providers: [{ ...answers.providers[0]!, wireFormat: 'grpc' as const }],
    } as unknown as WizardAnswers;
    expect(() => buildWizardConfig(bad)).toThrow(ConfigError);
  });
});
