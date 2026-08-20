import type { CanonicalRequest, PluginContext } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import { createPluginManager } from '../../application/plugin-manager.js';
import { RoutingConfigError } from '../../domain/index.js';
import {
  buildProviderRouting,
  createOpenRouterRoutingPlugin,
  type OpenRouterRoutingConfig,
} from './openrouter-routing.js';

type RawConfig = {
  only?: string | string[];
  order?: string | string[];
  ignore?: string | string[];
  allowFallbacks?: boolean;
  sort?:
    | 'price'
    | 'throughput'
    | 'latency'
    | { by: 'price' | 'throughput' | 'latency'; partition?: 'model' | 'none' };
  quantizations?: string[];
  maxPrice?: { prompt?: number; completion?: number; request?: number; image?: number };
  requireParameters?: boolean;
  dataCollection?: 'allow' | 'deny';
  zdr?: boolean;
  enforceDistillableText?: boolean;
  preferredMinThroughput?:
    | number
    | { p50?: number; p75?: number; p90?: number; p99?: number };
  preferredMaxLatency?:
    | number
    | { p50?: number; p75?: number; p90?: number; p99?: number };
};

function request(extensions: CanonicalRequest['extensions'] = {}): CanonicalRequest {
  return {
    model: { logical: 'm', physical: 'm' },
    system: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    params: {},
    stream: false,
    extensions,
  };
}

function ctx(config: RawConfig = {}): PluginContext<OpenRouterRoutingConfig> {
  return {
    requestId: 'r1',
    logger: console,
    clock: { now: () => 0 },
    random: { uuid: () => 'u' },
    config: config as OpenRouterRoutingConfig,
  };
}

describe('buildProviderRouting', () => {
  it('maps every field to its OpenRouter wire name', () => {
    // Arrange
    const config = {
      only: 'anthropic',
      order: ['anthropic', 'google'],
      ignore: ['deepseek'],
      quantizations: ['bf16'],
      sort: { by: 'throughput' as const, partition: 'model' as const },
      maxPrice: { prompt: 1, completion: 2 },
      requireParameters: true,
      dataCollection: 'deny' as const,
      zdr: true,
      enforceDistillableText: false,
      preferredMinThroughput: { p50: 50 },
      preferredMaxLatency: 100,
    };

    // Act
    const routing = buildProviderRouting(config);

    // Assert
    expect(routing).toEqual({
      only: ['anthropic'],
      order: ['anthropic', 'google'],
      ignore: ['deepseek'],
      quantizations: ['bf16'],
      sort: { by: 'throughput', partition: 'model' },
      max_price: { prompt: 1, completion: 2 },
      require_parameters: true,
      data_collection: 'deny',
      zdr: true,
      enforce_distillable_text: false,
      preferred_min_throughput: { p50: 50 },
      preferred_max_latency: 100,
      allow_fallbacks: true,
    });
  });

  it('respects an explicit allowFallbacks false beside order', () => {
    // Arrange
    const config = { order: ['anthropic'], allowFallbacks: false };

    // Act
    const routing = buildProviderRouting(config);

    // Assert
    expect(routing).toEqual({ order: ['anthropic'], allow_fallbacks: false });
  });

  it('returns undefined for an empty config', () => {
    // Arrange
    const config = {};

    // Act
    const routing = buildProviderRouting(config);

    // Assert
    expect(routing).toBeUndefined();
  });

  it('drops empty array fields', () => {
    // Arrange
    const config = { only: [] };

    // Act
    const routing = buildProviderRouting(config);

    // Assert
    expect(routing).toBeUndefined();
  });
});

describe('openrouter-routing plugin', () => {
  it('writes $proxitor.provider into the openai-chat extensions bag', async () => {
    // Arrange
    const plugin = createOpenRouterRoutingPlugin();
    const req = request({ 'openai-chat': { logprobs: true } });

    // Act
    const result = (await plugin.onRequest?.(
      ctx({ only: ['anthropic'], order: 'anthropic' }),
      req,
    )) as CanonicalRequest | undefined;

    // Assert — client passthrough preserved, reserved key added
    expect(result).not.toBe(req);
    expect(result?.extensions['openai-chat']).toEqual({
      logprobs: true,
      '$proxitor.provider': {
        only: ['anthropic'],
        order: ['anthropic'],
        allow_fallbacks: true,
      },
    });
  });

  it('creates the openai-chat bag when absent and keeps others untouched', async () => {
    // Arrange
    const plugin = createOpenRouterRoutingPlugin();
    const req = request({ 'anthropic-messages': { m: 1 } });

    // Act
    const result = (await plugin.onRequest?.(ctx({ order: ['anthropic'] }), req)) as
      | CanonicalRequest
      | undefined;

    // Assert
    expect(result?.extensions['anthropic-messages']).toEqual({ m: 1 });
    expect(result?.extensions['openai-chat']).toEqual({
      '$proxitor.provider': { order: ['anthropic'], allow_fallbacks: true },
    });
  });

  it('returns the same request when the config maps to no routing hints', async () => {
    // Arrange
    const plugin = createOpenRouterRoutingPlugin();
    const req = request();

    // Act
    const result = (await plugin.onRequest?.(ctx({}), req)) as
      | CanonicalRequest
      | undefined;

    // Assert
    expect(result).toBe(req);
  });

  it('is rejected on non-openai-chat routes by the activation gate', () => {
    // Arrange
    const manager = createPluginManager({
      plugins: new Map([['openrouter-routing', createOpenRouterRoutingPlugin()]]),
      logger: console,
    });

    // Act + Assert — Task 1's gate wired through the real manager
    expect(() =>
      manager.activate(
        [{ name: 'openrouter-routing', config: { only: ['anthropic'] } }],
        'anthropic-messages',
      ),
    ).toThrow(RoutingConfigError);
    expect(() =>
      manager.activate(
        [{ name: 'openrouter-routing', config: { only: ['anthropic'] } }],
        'openai-chat',
      ),
    ).not.toThrow();
  });

  it('declares its reserved key contract', () => {
    // Arrange
    const plugin = createOpenRouterRoutingPlugin();

    // Act + Assert
    expect(plugin.reservedKeys).toEqual({ 'openai-chat': ['$proxitor.provider'] });
  });
});
