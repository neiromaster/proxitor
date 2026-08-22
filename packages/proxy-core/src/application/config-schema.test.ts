import { describe, expect, test } from 'vitest';
import { ConfigError, parseConfig, redactConfigForLog } from './config-schema.js';

const FULL_CONFIG = {
  version: 1,
  plugins: ['normalize-volatile-system', { 'cache-control': { cacheControl: 'auto' } }],
  providers: {
    'openai-prod': {
      baseUrl: 'https://api.openai.com',
      wireFormat: 'openai-chat',
      auth: { type: 'bearer', credential: { env: 'OPENAI_API_KEY' } },
    },
    'anthropic-direct': {
      baseUrl: 'https://api.anthropic.com',
      wireFormat: 'anthropic-messages',
      auth: { type: 'x-api-key', credential: 'sk-ant-literal' },
      headers: { 'anthropic-version': '2023-06-01' },
      plugins: [{ 'cache-control': { cacheControl: 'auto' } }],
    },
  },
  models: [
    { match: 'gpt-5*', provider: 'openai-prod', modelId: 'gpt-5' },
    { match: 'claude-*', provider: 'anthropic-direct', modelId: '$MODEL' },
  ],
  defaultProvider: 'openai-prod',
  server: {
    host: '0.0.0.0',
    port: 9000,
    bodyLimit: '10mb',
    forwardHeaders: ['x-custom'],
  },
};

describe('parseConfig', () => {
  test('parses a full config and injects provider id from the record key', () => {
    const config = parseConfig(FULL_CONFIG);
    expect(config.version).toBe(1);
    expect(config.providers['openai-prod']?.id).toBe('openai-prod');
    expect(config.providers['anthropic-direct']?.headers?.['anthropic-version']).toBe(
      '2023-06-01',
    );
    expect(config.models).toHaveLength(2);
    expect(config.server).toEqual({
      host: '0.0.0.0',
      port: 9000,
      bodyLimitBytes: 10_485_760,
      forwardHeaders: ['x-custom'],
    });
  });

  test('applies defaults for absent sections and YAML null sections', () => {
    const minimal = {
      version: 1,
      providers: FULL_CONFIG.providers,
      models: FULL_CONFIG.models,
      logging: null,
    };
    const config = parseConfig(minimal);
    expect(config.server).toEqual({
      host: '127.0.0.1',
      port: 8828,
      bodyLimitBytes: 52_428_800,
      forwardHeaders: [],
    });
    expect(config.logging).toEqual({ verbose: false });
    expect(config.observability).toEqual({
      routerMetadata: true,
      hitThreshold: 80,
      sessionMaxEntries: 4096,
    });
  });

  test('rejects wrong version with a message naming version', () => {
    expect(() => parseConfig({ ...FULL_CONFIG, version: 2 })).toThrow(ConfigError);
    expect(() => parseConfig({ ...FULL_CONFIG, version: 2 })).toThrow(/version/);
  });

  test('rejects empty providers and empty models (minItems)', () => {
    expect(() => parseConfig({ ...FULL_CONFIG, providers: {} })).toThrow(
      /at least one provider/,
    );
    expect(() => parseConfig({ ...FULL_CONFIG, models: [] })).toThrow(
      /at least one binding/,
    );
  });

  test('parses bodyLimit in kb / mb / gb and raw byte numbers', () => {
    const getBodyLimitBytes = (bodyLimit: unknown) =>
      parseConfig({ ...FULL_CONFIG, server: { bodyLimit } }).server.bodyLimitBytes;
    expect(getBodyLimitBytes('10kb')).toBe(10_240);
    expect(getBodyLimitBytes('1GB')).toBe(1_073_741_824);
    expect(getBodyLimitBytes(2048)).toBe(2048);
    expect(() => getBodyLimitBytes('10xb')).toThrow(ConfigError);
  });

  test('controlPlane is absent-able and observability is shape-validated', () => {
    expect(parseConfig(FULL_CONFIG).controlPlane).toBeUndefined();
    expect(() =>
      parseConfig({
        ...FULL_CONFIG,
        controlPlane: { token: { env: 'T' } },
        observability: { hitThreshold: 'high' },
      }),
    ).toThrow(ConfigError);
    expect(
      parseConfig({ ...FULL_CONFIG, controlPlane: { token: { env: 'T' } } }).controlPlane,
    ).toEqual({ token: { env: 'T' } });
  });
});

describe('redactConfigForLog', () => {
  test('replaces every credential shape with [redacted]', () => {
    const redacted = redactConfigForLog(parseConfig(FULL_CONFIG));
    const text = JSON.stringify(redacted);
    expect(text).not.toContain('OPENAI_API_KEY');
    expect(text).not.toContain('sk-ant-literal');
    expect(text).toContain('[redacted]');
  });
});

describe('credential ref edges', () => {
  it('rejects an empty env ref name', () => {
    const input = {
      ...FULL_CONFIG,
      providers: {
        'test-provider': {
          baseUrl: 'https://api.example.com',
          wireFormat: 'openai-chat' as const,
          auth: { type: 'bearer' as const, credential: { env: '' } },
        },
      },
    };
    expect(() => parseConfig(input)).toThrow(ConfigError);
  });

  it('rejects an empty file ref path', () => {
    const input = {
      ...FULL_CONFIG,
      providers: {
        'test-provider': {
          baseUrl: 'https://api.example.com',
          wireFormat: 'openai-chat' as const,
          auth: { type: 'bearer' as const, credential: { file: '' } },
        },
      },
    };
    expect(() => parseConfig(input)).toThrow(ConfigError);
  });
});

describe('bodyLimit edges', () => {
  it('rejects 0 (both string "0mb" and numeric 0)', () => {
    const withString = { ...FULL_CONFIG, server: { bodyLimit: '0mb' } };
    expect(() => parseConfig(withString)).toThrow(ConfigError);

    const withNumber = { ...FULL_CONFIG, server: { bodyLimit: 0 } };
    expect(() => parseConfig(withNumber)).toThrow(ConfigError);
  });

  it('rejects negative integers', () => {
    const input = { ...FULL_CONFIG, server: { bodyLimit: -1 } };
    expect(() => parseConfig(input)).toThrow(ConfigError);
  });

  it('accepts fractional sizes by rounding to whole bytes', () => {
    // Fractional units yielding exact byte counts is correct behavior
    const input = { ...FULL_CONFIG, server: { bodyLimit: '1.5mb' } };
    const result = parseConfig(input);
    expect(result.server.bodyLimitBytes).toBe(Math.round(1.5 * 1024 ** 2));
  });
});
