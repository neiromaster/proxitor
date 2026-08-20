import type { CanonicalEvent, ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { createRoutingTable } from '../domain/index.js';
import { createPluginManager } from './plugin-manager.js';
import {
  createPipeline,
  type PipelineDeps,
  type PipelineRequest,
} from './proxy-pipeline.js';
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

function makeDeps(
  fetchPort: PipelineDeps['fetch'],
  plugins: ReadonlyMap<string, ProxyPlugin> = new Map(),
  providers: Record<string, ProviderConfig> = {
    ant: ANTHROPIC_PROVIDER,
    oai: OPENAI_PROVIDER,
  },
  models: Parameters<typeof createRoutingTable>[0]['models'] = [
    { match: 'claude-*', provider: 'oai', modelId: 'gpt-5-real' },
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

const ANTHROPIC_STREAM_BODY = JSON.stringify({
  model: 'claude-sonnet-5',
  max_tokens: 64,
  stream: true,
  messages: [{ role: 'user', content: 'hi' }],
});

const ANTHROPIC_BODY = JSON.stringify({
  model: 'claude-sonnet-5',
  max_tokens: 64,
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
});

function request(body = ANTHROPIC_STREAM_BODY): PipelineRequest {
  return { path: '/v1/messages', method: 'POST', headers: {}, body };
}

async function readBody(body: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of body) {
    text += chunk;
  }
  return text;
}

const OAI_SSE = [
  'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
  'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
  'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
];

const OAI_JSON = JSON.stringify({
  id: 'c',
  model: 'gpt-5-real',
  choices: [
    { index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
});

describe('pipeline handle — upstream request shaping', () => {
  it('encodes the outbound body with the physical model and §5.4 headers (D9, D4)', async () => {
    // Arrange
    const upstream = fakeFetch(200, OAI_SSE);
    const pipeline = createPipeline(makeDeps(upstream.port));
    // Act
    await readBody((await pipeline.handle(request())).body);
    // Assert
    expect(upstream.calls.length).toBe(1);
    const call = upstream.calls[0];
    if (call === undefined) throw new Error('no upstream call');
    expect(call.url).toBe('https://oai.example.com/v1/chat/completions');
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers.accept).toBe('text/event-stream');
    expect(call.headers.authorization).toBe('Bearer resolved-secret');
    expect(JSON.parse(call.body).model).toBe('gpt-5-real'); // physical, not claude-sonnet-5
  });

  it("passes the logical model through $MODEL with the client's casing verbatim (M3 deferred contract)", async () => {
    // Arrange — a $MODEL binding; the client's odd casing must survive round-trip
    const upstream = fakeFetch(200, OAI_SSE);
    const deps = makeDeps(upstream.port, undefined, { oai: OPENAI_PROVIDER }, [
      { match: 'claude-*', provider: 'oai', modelId: '$MODEL' },
    ]);
    const pipeline = createPipeline(deps);
    const body = JSON.stringify({
      model: 'Claude-Sonnet-5',
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    // Act
    await readBody((await pipeline.handle(request(body))).body);
    // Assert — matched case-insensitively, forwarded case-preserving
    const call = upstream.calls[0];
    if (call === undefined) throw new Error('no upstream call');
    expect(JSON.parse(call.body).model).toBe('Claude-Sonnet-5');
  });

  it('lets plugins add outboundHeaders but not forge authorization (D4)', async () => {
    // Arrange
    const upstream = fakeFetch(200, OAI_SSE);
    const headerPlugin: ProxyPlugin = {
      name: 'headerPlugin',
      onRequest: (_ctx, ir) => ({
        ...ir,
        outboundHeaders: { 'x-plugin': '1', authorization: 'evil' },
      }),
    };
    const pipeline = createPipeline(
      makeDeps(upstream.port, new Map([['headerPlugin', headerPlugin]])),
    );
    // Act
    await readBody((await pipeline.handle(request())).body);
    // Assert
    const call = upstream.calls[0];
    if (call === undefined) throw new Error('no upstream call');
    expect(call.headers['x-plugin']).toBe('1');
    expect(call.headers.authorization).toBe('Bearer resolved-secret');
  });
});

describe('pipeline handle — response translation', () => {
  it('bridges openai SSE upstream to an anthropic SSE client (inbound≠outbound)', async () => {
    // Arrange
    const upstream = fakeFetch(200, OAI_SSE);
    const pipeline = createPipeline(makeDeps(upstream.port));
    // Act
    const response = await pipeline.handle(request());
    const text = await readBody(response.body);
    // Assert
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(text).toContain('"type":"message_start"');
    expect(text).toContain('"model":"claude-sonnet-5"'); // logical name to the client (D9)
    expect(text).toContain('Hi');
    expect(text).toContain('"type":"message_stop"');
  });

  it('bridges a non-stream openai JSON upstream to a buffered anthropic JSON client (D11)', async () => {
    // Arrange
    const upstream = fakeFetch(200, [OAI_JSON]);
    const pipeline = createPipeline(makeDeps(upstream.port));
    // Act
    const response = await pipeline.handle(request(ANTHROPIC_BODY));
    const parsed = JSON.parse(await readBody(response.body)) as {
      model: string;
      content: Array<{ text?: string }>;
    };
    // Assert
    expect(response.headers['content-type']).toBe('application/json');
    expect(parsed.model).toBe('claude-sonnet-5');
    expect(parsed.content[0]?.text).toBe('Hi');
  });
});

describe('pipeline handle — error paths', () => {
  it('passes an upstream non-2xx through onError hooks and renders it in the client shape', async () => {
    // Arrange
    const upstream = fakeFetch(401, [JSON.stringify({ error: { message: 'bad key' } })]);
    let seenStatus = 0;
    const polisher: ProxyPlugin = {
      name: 'polisher',
      onError: (_ctx, error) => {
        seenStatus = error.status;
        return { ...error, message: `polished: ${error.message}` };
      },
    };
    const pipeline = createPipeline(
      makeDeps(upstream.port, new Map([['polisher', polisher]])),
    );
    // Act
    const response = await pipeline.handle(request(ANTHROPIC_BODY));
    const parsed = JSON.parse(await readBody(response.body)) as {
      error: { message: string; type: string };
    };
    // Assert
    expect(seenStatus).toBe(401);
    expect(response.status).toBe(401);
    expect(parsed.error.message).toBe('polished: upstream oai responded 401');
    expect(parsed.error.type).toBe('upstream_error');
  });

  it('runs onError for mid-stream error events and re-encodes them (spec §7)', async () => {
    // Arrange - stream ends without [DONE], triggering decoder error
    const upstream = fakeFetch(200, [
      'data: {"id":"c","model":"gpt-5-real","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
    ]);
    const marker: ProxyPlugin = {
      name: 'marker',
      onError: (_ctx, error) => ({ ...error, message: `marked: ${error.message}` }),
    };
    const pipeline = createPipeline(
      makeDeps(upstream.port, new Map([['marker', marker]])),
    );
    // Act
    const text = await readBody((await pipeline.handle(request())).body);
    // Assert - the decoder creates stream_truncated error, which goes through onError
    expect(text).toContain('marked: stream ended without [DONE]');
    expect(text).toContain('"type":"error"');
  });

  it('renders an unreachable upstream as 502 upstream_unreachable', async () => {
    // Arrange
    const port = {
      fetch: async () => {
        throw new Error('connection refused');
      },
    };
    const pipeline = createPipeline(makeDeps(port));
    // Act
    const response = await pipeline.handle(request(ANTHROPIC_BODY));
    const parsed = JSON.parse(await readBody(response.body)) as {
      error: { type: string; message: string };
    };
    // Assert
    expect(response.status).toBe(502);
    expect(parsed.error.type).toBe('upstream_unreachable');
    expect(parsed.error.message).toContain('connection refused');
  });

  it('closes the client stream cleanly with plugin_stream_error when a transform throws (D8)', async () => {
    // Arrange
    const upstream = fakeFetch(200, OAI_SSE);
    const bomber: ProxyPlugin = {
      name: 'bomber',
      transformStream: async function* (_ctx, events) {
        for await (const event of events) {
          if (event.type === 'content_block_delta') {
            throw new Error('transform boom');
          }
          yield event;
        }
      },
    };
    const pipeline = createPipeline(
      makeDeps(upstream.port, new Map([['bomber', bomber]])),
    );
    // Act — readBody resolving at all proves the clean close
    const text = await readBody((await pipeline.handle(request())).body);
    // Assert
    expect(text).toContain('plugin_stream_error');
    expect(text).toContain('transform boom');
  });

  it('renders a transform-injected error event as the response in non-stream mode (I1)', async () => {
    // Arrange - non-stream request + plugin that yields error event
    const upstream = fakeFetch(200, [OAI_JSON]);
    const errorInjector: ProxyPlugin = {
      name: 'errorInjector',
      transformStream: async function* (_ctx, events) {
        for await (const event of events) {
          // Replace first content_block_delta with an error event
          if (event.type === 'content_block_delta') {
            yield {
              type: 'error',
              error: {
                type: 'overloaded_error',
                message: 'no capacity',
                status: 529,
              },
            };
            return; // stop the stream
          }
          yield event;
        }
      },
    };
    const pipeline = createPipeline(
      makeDeps(upstream.port, new Map([['errorInjector', errorInjector]])),
    );
    // Act
    const response = await pipeline.handle(request(ANTHROPIC_BODY));
    const parsed = JSON.parse(await readBody(response.body)) as {
      error: { type: string; message: string };
    };
    // Assert - must resolve (no rejection) with status 529 and error body
    expect(response.status).toBe(529);
    expect(parsed.error.type).toBe('overloaded_error');
    expect(parsed.error.message).toBe('no capacity');
  });

  it('catches a throwing credentials.resolve and renders 500 internal_error (I2)', async () => {
    // Arrange - credentials.resolve that throws
    const upstream = fakeFetch(200, [OAI_JSON]);
    const throwingDeps = makeDeps(upstream.port);
    // Create a new deps object with throwing credentials instead of mutating
    const depsWithThrowingCredentials: PipelineDeps = {
      ...throwingDeps,
      credentials: {
        resolve: () => {
          throw new Error('env unset');
        },
      },
    };
    const pipeline = createPipeline(depsWithThrowingCredentials);
    // Act
    const response = await pipeline.handle(request(ANTHROPIC_BODY));
    const parsed = JSON.parse(await readBody(response.body)) as {
      error: { type: string; message: string };
    };
    // Assert - must resolve (no rejection) with status 500 and error body containing 'env unset'
    expect(response.status).toBe(500);
    expect(parsed.error.type).toBe('internal_error');
    expect(parsed.error.message).toContain('env unset');
  });
});

describe('pipeline handle — stream transforms and observers', () => {
  it('composes transformStream in reverse so the first plugin is outermost (D19)', async () => {
    // Arrange — two async generators that wrap text with tags
    const first: ProxyPlugin = {
      name: 'first',
      transformStream: async function* (_ctx, events) {
        for await (const event of events) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text') {
            yield { ...event, delta: { type: 'text', text: `${event.delta.text}(a)` } };
            continue;
          }
          yield event;
        }
      },
    };
    const second: ProxyPlugin = {
      name: 'second',
      transformStream: async function* (_ctx, events) {
        for await (const event of events) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text') {
            yield { ...event, delta: { type: 'text', text: `${event.delta.text}(b)` } };
            continue;
          }
          yield event;
        }
      },
    };
    const upstream = fakeFetch(200, OAI_SSE);
    const pipeline = createPipeline(
      makeDeps(
        upstream.port,
        new Map([
          ['first', first],
          ['second', second],
        ]),
      ),
    );
    // Act
    const text = await readBody((await pipeline.handle(request())).body);
    // Assert — reverse composition means 'first' wraps 'second': outermost (first) appends LAST
    // Base 'Hi' → second adds '(b)' → first adds '(a)' → 'Hi(b)(a)'
    // Forward composition would produce 'Hi(a)(b)'
    expect(text).toContain('Hi(b)(a)');
  });

  it('shows onEvent observers the post-transform events (spec §7)', async () => {
    // Arrange
    const observed: CanonicalEvent[] = [];
    const rewriter: ProxyPlugin = {
      name: 'rewriter',
      transformStream: async function* (_ctx, events) {
        for await (const event of events) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text') {
            yield { ...event, delta: { type: 'text', text: `${event.delta.text}!` } };
            continue;
          }
          yield event;
        }
      },
    };
    const watcher: ProxyPlugin = {
      name: 'watcher',
      onEvent: (_ctx, event) => {
        observed.push(event);
      },
    };
    const upstream = fakeFetch(200, OAI_SSE);
    const pipeline = createPipeline(
      makeDeps(
        upstream.port,
        new Map([
          ['rewriter', rewriter],
          ['watcher', watcher],
        ]),
      ),
    );
    // Act
    const text = await readBody((await pipeline.handle(request())).body);
    // Assert
    const delta = observed.find(event => event.type === 'content_block_delta');
    expect(
      delta !== undefined &&
        delta.type === 'content_block_delta' &&
        delta.delta.type === 'text'
        ? delta.delta.text
        : '',
    ).toBe('Hi!');
    expect(text).toContain('Hi!');
  });
});
