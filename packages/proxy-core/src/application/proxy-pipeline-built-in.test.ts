import type { ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import { createRoutingTable, type PluginListEntry } from '../domain/index.js';
import { createBuiltInPluginRegistry } from '../plugins/built-in/index.js';
import { createPluginManager } from './plugin-manager.js';
import { createPipeline, type PipelineDeps } from './proxy-pipeline.js';
import type { UpstreamRequest, UpstreamResponse } from './upstream-fetch.js';

const logger = {
  info(_m: string) {},
  warn(_m: string) {},
  error(_m: string) {},
  debug(_m: string) {},
};

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

function fakeFetch(status: number, chunks: string[]) {
  const calls: UpstreamRequest[] = [];
  const port = {
    fetch: async (request: UpstreamRequest): Promise<UpstreamResponse> => {
      calls.push(request);
      return { status, headers: {}, body: fromChunks(chunks) };
    },
  };
  return { calls, port };
}

function makeDeps(
  fetchPort: PipelineDeps['fetch'],
  plugins: ReadonlyMap<string, ProxyPlugin>,
  providerPlugins: readonly PluginListEntry[],
): PipelineDeps {
  return {
    table: createRoutingTable({
      providers: {
        ant: {
          id: 'ant',
          baseUrl: 'https://ant.example.com',
          wireFormat: 'anthropic-messages',
          auth: { type: 'x-api-key', credential: 'sk-ant-test' },
          headers: { 'anthropic-version': '2023-06-01' },
          plugins: providerPlugins,
        },
      },
      models: [{ match: 'claude-*', provider: 'ant', modelId: 'claude-real' }],
      defaultProvider: 'ant',
    }),
    manager: createPluginManager({ plugins, logger }),
    fetch: fetchPort,
    credentials: {
      resolve: (ref: unknown) => (typeof ref === 'string' ? ref : 'resolved'),
    },
    logger,
    clock: { now: () => 0 },
    random: { uuid: () => 'req-1' },
  };
}

const BODY = JSON.stringify({
  model: 'claude-sonnet-5',
  max_tokens: 64,
  stream: false,
  system: [
    {
      type: 'text',
      text: 'agent cch=deadbeef cc_version=2.1.3.cafe123',
      cache_control: { type: 'ephemeral', ttl: '5m' },
    },
    { type: 'text', text: 'extra instructions' },
  ],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
});

const UPSTREAM_JSON = JSON.stringify({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-real',
  content: [{ type: 'text', text: 'Hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
});

describe('built-in plugins through the pipeline', () => {
  it('normalize + rewrite + inject + session-id all land on the upstream request', async () => {
    // Arrange
    const { calls, port } = fakeFetch(200, [UPSTREAM_JSON]);
    const pipeline = createPipeline(
      makeDeps(port, createBuiltInPluginRegistry(), [
        'normalize-volatile-system',
        { 'cache-control': { ttl: '1h' } },
        'session-id',
      ]),
    );

    // Act
    const response = await pipeline.handle({
      path: '/v1/messages',
      method: 'POST',
      headers: {},
      body: BODY,
    });
    let clientBody = '';
    for await (const chunk of response.body) clientBody += chunk;

    // Assert
    expect(response.status).toBe(200);
    const sent = JSON.parse(calls[0]?.body ?? '{}');
    expect(sent.system[0].text).toBe('agent cch=00000 cc_version=2.1.3.0'); // normalize-volatile-system
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' }); // rewrite 5m → 1h
    expect(sent.system[1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' }); // inject (auto: breakpoint existed)
    expect(calls[0]?.headers['x-session-id']).toMatch(/^[0-9a-f]{64}$/); // session-id
    expect(JSON.parse(clientBody).content).toEqual([{ type: 'text', text: 'Hello' }]); // passthrough reply
  });

  it('openrouter-routing on an anthropic route fails activation with plugin_config_error', async () => {
    // Arrange — the registry already contains openrouter-routing; the provider wires only it
    const { port } = fakeFetch(200, [UPSTREAM_JSON]);
    const pipeline = createPipeline(
      makeDeps(port, createBuiltInPluginRegistry(), ['openrouter-routing']),
    );

    // Act
    const response = await pipeline.handle({
      path: '/v1/messages',
      method: 'POST',
      headers: {},
      body: BODY,
    });
    let clientBody = '';
    for await (const chunk of response.body) clientBody += chunk;

    // Assert
    expect(response.status).toBe(500);
    expect(JSON.parse(clientBody)).toEqual({
      type: 'error',
      error: {
        type: 'plugin_config_error',
        message: expect.stringContaining('openrouter-routing'),
      },
    });
  });
});
