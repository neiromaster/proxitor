import type { CanonicalEvent, ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { createRoutingTable } from '../domain/index.js';
import type { ObservabilityPort, ObservationContext } from './observability.js';
import { createPluginManager } from './plugin-manager.js';
import type { PipelineDeps, PipelineRequest } from './proxy-pipeline.js';
import { createPipeline, prepareUpstream } from './proxy-pipeline.js';

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

function makeTable(plugins: readonly string[] = []) {
  return createRoutingTable({
    providers: { ant: ANTHROPIC_PROVIDER, oai: OPENAI_PROVIDER },
    models: [
      { match: 'claude-*', provider: 'ant', modelId: '$MODEL', plugins },
      { match: 'gpt-*', provider: 'oai', modelId: 'gpt-5-real' },
    ],
  });
}

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

function makeDeps(
  plugins: ReadonlyMap<string, ProxyPlugin> = new Map(),
  fetchPort?: PipelineDeps['fetch'],
  observabilityPort?: ObservabilityPort,
): PipelineDeps {
  return {
    table: makeTable([...plugins.keys()]),
    manager: createPluginManager({ plugins, logger }),
    fetch: fetchPort ?? {
      fetch: async () => {
        throw new Error('upstream not under test');
      },
    },
    credentials: {
      resolve: (ref: unknown) => (typeof ref === 'string' ? ref : 'resolved-secret'),
    },
    logger,
    clock: { now: () => 0 },
    random: { uuid: () => 'req-1' },
    observability: observabilityPort,
  };
}

function fakeObservability() {
  const begun: ObservationContext[] = [];
  const ended: number[] = [];
  const events: string[] = [];
  const port: ObservabilityPort = {
    begin(ctx) {
      begun.push(ctx);
      return {
        onEvent: e => events.push(e.type),
        captureOutbound: () => {},
        end: status => {
          ended.push(status);
        },
      };
    },
    reconfigure: () => {},
  };
  return { port, begun, ended, events };
}

const OPENAI_JSON = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-5-real',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hi' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
});

const OPENAI_SSE = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"gpt-5-real","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"gpt-5-real","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"gpt-5-real","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
];

const ANTHROPIC_BODY = JSON.stringify({
  model: 'claude-sonnet-5',
  max_tokens: 64,
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
});

function anthropicRequest(body = ANTHROPIC_BODY): PipelineRequest {
  return { path: '/v1/messages', method: 'POST', headers: {}, body };
}

function openaiRequest(stream = false): PipelineRequest {
  return {
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {},
    body: JSON.stringify({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      stream,
    }),
  };
}

describe('pipeline observability tap', () => {
  it('observes decode failure with status 400 and empty model', async () => {
    const { port, begun, ended } = fakeObservability();
    const deps = makeDeps(new Map(), undefined, port);

    const outcome = await prepareUpstream(anthropicRequest('not-json'), deps);

    expect(outcome.kind).toBe('error');
    expect(begun).toHaveLength(1);
    expect(begun[0]!.model).toBe('');
    expect(ended).toEqual([400]);
  });

  it('observes routing failure with error status', async () => {
    const { port, begun, ended } = fakeObservability();
    const deps = makeDeps(new Map(), undefined, port);

    const body = JSON.stringify({
      ...JSON.parse(ANTHROPIC_BODY),
      model: 'unknown-model',
    });
    const outcome = await prepareUpstream(anthropicRequest(body), deps);

    expect(outcome.kind).toBe('error');
    expect(begun).toHaveLength(1);
    expect(ended[0]).toBe(400);
  });

  it('observes short-circuit stream with events and status', async () => {
    const { port, begun, ended, events } = fakeObservability();
    const plugin: ProxyPlugin = {
      name: 'sc-plugin',
      onRequest: () => ({
        shortCircuit: true,
        status: 202,
        events: [
          {
            type: 'message_start',
            id: 'msg-1',
            model: 'claude-sonnet-5',
            message: { type: 'message', id: 'msg-1', role: 'assistant' },
          },
          {
            type: 'content_block_start',
            index: 0,
            block: { type: 'text', text: 'done' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text', text: 'done' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 4 },
          },
        ] as CanonicalEvent[],
        stream: true,
      }),
    };
    const deps = makeDeps(new Map([['sc-plugin', plugin]]), undefined, port);

    const outcome = await prepareUpstream(anthropicRequest(), deps);

    expect(outcome.kind).toBe('shortCircuit');
    expect(begun).toHaveLength(1);
    expect(ended).toEqual([202]);
    expect(events).toContain('message_start');
  });

  it('observes upstream unreachable as 502', async () => {
    const { port, begun, ended } = fakeObservability();
    const deps = makeDeps(
      new Map(),
      {
        fetch: async () => {
          throw new Error('network failure');
        },
      },
      port,
    );

    const pipeline = createPipeline(deps);
    const response = await pipeline.handle(anthropicRequest());

    expect(response.status).toBe(502);
    expect(begun.length).toBeGreaterThanOrEqual(1);
    expect(ended).toContain(502);
  });

  it('observes upstream non-2xx with upstream status', async () => {
    const { port, begun, ended } = fakeObservability();
    const deps = makeDeps(
      new Map(),
      {
        fetch: async () => ({
          status: 429,
          headers: { 'content-type': 'application/json' },
          body: fromChunks(['{"error":{"type":"rate_limit_error"}}']),
        }),
      },
      port,
    );

    const pipeline = createPipeline(deps);
    const response = await pipeline.handle(anthropicRequest());

    expect(response.status).toBe(429);
    expect(begun.length).toBeGreaterThanOrEqual(1);
    expect(ended).toContain(429);
  });

  it('observes non-stream success with usage events and status 200', async () => {
    const { port, begun, ended, events } = fakeObservability();
    const deps = makeDeps(
      new Map(),
      {
        fetch: async () => ({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: fromChunks([OPENAI_JSON]),
        }),
      },
      port,
    );

    const pipeline = createPipeline(deps);
    const response = await pipeline.handle(openaiRequest());

    expect(response.status).toBe(200);
    expect(begun.length).toBeGreaterThanOrEqual(1);
    expect(ended).toContain(200);
    expect(events).toContain('message_delta');
  });

  it('observes stream success with status 200 after full consumption', async () => {
    const { port, begun, ended, events } = fakeObservability();
    const deps = makeDeps(
      new Map(),
      {
        fetch: async () => ({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: fromChunks(OPENAI_SSE),
        }),
      },
      port,
    );

    const pipeline = createPipeline(deps);
    const response = await pipeline.handle(openaiRequest(true));

    expect(response.status).toBe(200);
    expect(begun.length).toBeGreaterThanOrEqual(1);

    // Consume the stream to trigger the finally block
    const bodyChunks: string[] = [];
    for await (const chunk of response.body) {
      bodyChunks.push(chunk);
    }

    expect(ended).toContain(200);
    expect(events).toContain('message_delta');
  });

  it('observes client disconnect mid-stream with status 200', async () => {
    const { port, ended } = fakeObservability();
    const upstreamChunks = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"gpt-5-real","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      // More chunks would follow but client disconnects
    ];
    const deps = makeDeps(
      new Map(),
      {
        fetch: async () => ({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: fromChunks(upstreamChunks),
        }),
      },
      port,
    );

    const pipeline = createPipeline(deps);
    const response = await pipeline.handle(openaiRequest(true));

    expect(response.status).toBe(200);

    // Simulate client disconnect by calling return() on the iterator
    const iterator = response.body[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);

    // Client disconnects
    await iterator.return?.();

    expect(ended).toContain(200);
  });

  it('does not emit duplicate observations (idempotence)', async () => {
    const { port, begun, ended } = fakeObservability();
    const deps = makeDeps(
      new Map(),
      {
        fetch: async () => ({
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: fromChunks(['{"error":{"type":"internal_error"}}']),
        }),
      },
      port,
    );

    const pipeline = createPipeline(deps);
    await pipeline.handle(anthropicRequest());

    // Each termination path emits exactly once
    const beginCount = begun.length;
    const endCount = ended.length;

    expect(endCount).toBe(beginCount);
    expect(endCount).toBeGreaterThan(0);
  });

  it('works unchanged when observability is absent from deps', async () => {
    const deps = makeDeps();
    const pipeline = createPipeline(deps);

    // Should succeed without crashing
    const response = await pipeline.handle(anthropicRequest());

    // Verify basic pipeline behavior still works
    expect(response).toBeDefined();
  });

  it('observes short-circuit non-stream with error event', async () => {
    const { port, begun, ended } = fakeObservability();
    const plugin: ProxyPlugin = {
      name: 'sc-error-plugin',
      onRequest: () => ({
        shortCircuit: true,
        status: 418,
        error: {
          type: 'invalid_request_error',
          message: 'short circuit',
          status: 418,
        },
      }),
    };
    const deps = makeDeps(new Map([['sc-error-plugin', plugin]]), undefined, port);

    const outcome = await prepareUpstream(anthropicRequest(), deps);

    expect(outcome.kind).toBe('shortCircuit');
    expect(begun).toHaveLength(1);
    expect(ended).toEqual([418]);
  });

  it('observes short-circuit non-stream success', async () => {
    const { port, begun, ended } = fakeObservability();
    const plugin: ProxyPlugin = {
      name: 'sc-success-plugin',
      onRequest: () => ({
        shortCircuit: true,
        status: 200,
        events: [
          {
            type: 'message_start',
            id: 'msg-1',
            model: 'claude-sonnet-5',
            message: { type: 'message', id: 'msg-1', role: 'assistant' },
          },
          {
            type: 'content_block_start',
            index: 0,
            block: { type: 'text', text: 'done' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 8 },
          },
        ] as CanonicalEvent[],
      }),
    };
    const deps = makeDeps(new Map([['sc-success-plugin', plugin]]), undefined, port);

    const outcome = await prepareUpstream(anthropicRequest(), deps);

    expect(outcome.kind).toBe('shortCircuit');
    expect(begun).toHaveLength(1);
    expect(ended).toEqual([200]);
  });
});
