import type { ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { createRoutingTable } from '../domain/index.js';
import { createPluginManager } from './plugin-manager.js';
import { createPipeline, type PipelineDeps } from './proxy-pipeline.js';
import type { UpstreamRequest, UpstreamResponse } from './upstream-fetch.js';

const ANTHROPIC_PROVIDER: ProviderConfig = {
  id: 'ant',
  baseUrl: 'https://ant.example.com',
  wireFormat: 'anthropic-messages',
  auth: { type: 'x-api-key', credential: 'sk-ant-test' },
  headers: { 'anthropic-version': '2023-06-01' },
};

const OPENAI_PROVIDER: ProviderConfig = {
  id: 'oai',
  baseUrl: 'https://oai.example.com',
  wireFormat: 'openai-chat',
  auth: { type: 'bearer', credential: { env: 'OAI_KEY' } },
};

const logger = {
  infos: [] as string[],
  warns: [] as string[],
  errors: [] as string[],
  debugs: [] as string[],
  info(message: string) {
    this.infos.push(message);
  },
  warn(message: string) {
    this.warns.push(message);
  },
  error(message: string) {
    this.errors.push(message);
  },
  debug(message: string) {
    this.debugs.push(message);
  },
};

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Fake upstream: records every fetch call, replies with a fixed response. */
function fakeFetch(
  status: number,
  chunks: string[],
  headers: Record<string, string> = {},
) {
  const calls: UpstreamRequest[] = [];
  const port = {
    fetch: async (request: UpstreamRequest): Promise<UpstreamResponse> => {
      calls.push(request);
      return { status, headers, body: fromChunks(chunks) };
    },
  };
  return { calls, port };
}

function baseDeps(
  fetchPort: PipelineDeps['fetch'],
  plugins: ReadonlyMap<string, ProxyPlugin> = new Map(),
  providers: Record<string, ProviderConfig> = {
    ant: ANTHROPIC_PROVIDER,
    oai: OPENAI_PROVIDER,
  },
  models: Parameters<typeof createRoutingTable>[0]['models'] = [
    { match: 'gpt-*', provider: 'oai', modelId: 'gpt-5-real' },
  ],
  pluginNames: readonly string[] = [],
): PipelineDeps {
  // Add plugin names to the provider if specified, otherwise extract from plugins map
  const effectivePluginNames =
    pluginNames.length > 0 ? pluginNames : Array.from(plugins.keys());
  let providersWithPlugins = { ...providers };
  if (effectivePluginNames.length > 0) {
    providersWithPlugins = Object.fromEntries(
      Object.entries(providers).map(([key, provider]) => [
        key,
        { ...provider, plugins: effectivePluginNames },
      ]),
    ) as typeof providers;
  }
  return {
    table: createRoutingTable({
      providers: providersWithPlugins,
      models,
      defaultProvider: 'oai',
    }),
    manager: createPluginManager({
      plugins,
      logger,
    }),
    fetch: fetchPort,
    credentials: {
      resolve: (ref: unknown) => (typeof ref === 'string' ? ref : 'resolved-secret'),
    },
    logger,
    clock: { now: () => 0 },
    random: { uuid: () => 'req-1' },
  };
}

const OPENAI_BODY = JSON.stringify({
  model: 'gpt-5',
  stream: true,
  messages: [{ role: 'user', content: 'Hi' }],
});

describe('PipelineDeps.forwardHeaders', () => {
  test('listed client headers are forwarded upstream; unlisted ones are not', async () => {
    // Arrange — openai provider + fake upstream capturing headers
    const { calls, port } = fakeFetch(200, ['data: {"id":"x"}\n\n', 'data: [DONE]\n\n']);
    const pipeline = createPipeline({
      ...baseDeps(port),
      forwardHeaders: ['x-custom'],
    });

    // Act
    await pipeline.handle({
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'x-custom': 'yes', 'x-other': 'no' },
      body: OPENAI_BODY,
    });

    // Assert
    const sent = calls[0]?.headers ?? {};
    expect(sent['x-custom']).toBe('yes');
    expect(sent['x-other']).toBeUndefined();
  });

  test('config names match case-insensitively (X-Custom matches x-custom)', async () => {
    // Arrange
    const { calls, port } = fakeFetch(200, ['data: [DONE]\n\n']);
    const pipeline = createPipeline({ ...baseDeps(port), forwardHeaders: ['X-Custom'] });
    // Act
    await pipeline.handle({
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'x-custom': 'v' },
      body: OPENAI_BODY,
    });
    // Assert
    expect(calls[0]?.headers['x-custom']).toBe('v');
  });
});
