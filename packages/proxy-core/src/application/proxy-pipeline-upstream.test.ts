import type { CanonicalEvent, ProxyPlugin } from '@proxitor/plugin-api';
import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../domain/index.js';
import { createRoutingTable } from '../domain/index.js';
import type { ObservabilityPort } from './observability.js';
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
  observability?: ObservabilityPort,
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
    observability,
  };
}

/** Fake observability tap: records begin contexts, end statuses, and event types. */
function fakeObservability() {
  const begun: string[] = [];
  const ended: number[] = [];
  const events: string[] = [];
  const port: ObservabilityPort = {
    begin(ctx) {
      begun.push(ctx.requestId);
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

  it('records the emitted error-frame status, not 200, when the stream pipeline fails', async () => {
    // Arrange - the D8 transform bomber plus an observation tap
    const upstream = fakeFetch(200, OAI_SSE);
    const { port, ended } = fakeObservability();
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
      makeDeps(
        upstream.port,
        new Map([['bomber', bomber]]),
        undefined,
        undefined,
        [],
        port,
      ),
    );
    // Act - readBody resolving at all proves the clean close
    const text = await readBody((await pipeline.handle(request())).body);
    // Assert - the client got the error frame and the observation ended with its status
    expect(text).toContain('transform boom');
    expect(ended).toEqual([500]);
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

  it('catches a throwing credentials.resolve as a 500 in the client shape with the observation ended', async () => {
    // Arrange - credentials.resolve that throws
    const upstream = fakeFetch(200, [OAI_JSON]);
    const { port, ended } = fakeObservability();
    const throwingDeps = makeDeps(
      upstream.port,
      undefined,
      undefined,
      undefined,
      [],
      port,
    );
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
      type: string;
      error: { type: string; message: string };
    };
    // Assert - no rejection, anthropic envelope (client's inbound format, not the
    // terminal catch's openai shape), 500 status, observation ended, no upstream call
    expect(response.status).toBe(500);
    expect(parsed.type).toBe('error');
    expect(parsed.error.type).toBe('internal_error');
    expect(parsed.error.message).toContain('env unset');
    expect(upstream.calls.length).toBe(0);
    expect(ended).toEqual([500]);
  });

  it('renders an unexpressible top_k as 400 in the client shape with the observation ended', async () => {
    // Arrange - anthropic-messages inbound with top_k routed to an openai-chat provider
    const upstream = fakeFetch(200, [OAI_JSON]);
    const { port, ended } = fakeObservability();
    const deps = makeDeps(upstream.port, undefined, undefined, undefined, [], port);
    const pipeline = createPipeline(deps);
    const body = JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 64,
      stream: false,
      top_k: 5,
      messages: [{ role: 'user', content: 'hi' }],
    });
    // Act
    const response = await pipeline.handle(request(body));
    const parsed = JSON.parse(await readBody(response.body)) as {
      type: string;
      error: { type: string; message: string };
    };
    // Assert - anthropic error envelope with the encode failure, observation ended,
    // and the request never reached the upstream
    expect(response.status).toBe(400);
    expect(parsed.type).toBe('error');
    expect(parsed.error.type).toBe('invalid_request_error');
    expect(parsed.error.message).toContain('top_k');
    expect(upstream.calls.length).toBe(0);
    expect(ended).toEqual([400]);
  });

  it('encodes with unsupportedParams drop: top_k is omitted and the request reaches the upstream (spec §10)', async () => {
    // Arrange — openai-chat provider opted into dropping inexpressible params
    const upstream = fakeFetch(200, [OAI_JSON]);
    const deps = makeDeps(upstream.port, undefined, {
      oai: { ...OPENAI_PROVIDER, unsupportedParams: 'drop' },
    });
    const pipeline = createPipeline(deps);
    const body = JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 64,
      stream: false,
      top_k: 5,
      messages: [{ role: 'user', content: 'hi' }],
    });
    // Act
    const response = await pipeline.handle(request(body));
    const parsed = JSON.parse(await readBody(response.body)) as {
      content: Array<{ text?: string }>;
    };
    // Assert — the 200-path encode succeeded, the upstream saw no top_k,
    // and the client got the translated answer
    expect(response.status).toBe(200);
    expect(upstream.calls.length).toBe(1);
    const call = upstream.calls[0];
    if (call === undefined) throw new Error('no upstream call');
    expect(JSON.parse(call.body).top_k).toBeUndefined();
    expect(parsed.content[0]?.text).toBe('Hi');
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

describe('pipeline handle — client disconnect abort (B2.1)', () => {
  it('attaches onClientDisconnect that aborts the upstream fetch handle', async () => {
    // Arrange — upstream body stalls forever (never yields, never closes)
    let captured: AbortController | undefined;
    async function* stalled(): AsyncGenerator<string> {
      await new Promise<void>(() => {});
    }
    const port = {
      fetch: async (): Promise<UpstreamResponse> => {
        const controller = new AbortController();
        captured = controller;
        return {
          status: 200,
          headers: {},
          body: stalled(),
          abort: () => controller.abort(),
        };
      },
    };
    const pipeline = createPipeline(makeDeps(port));
    // Act
    const response = await pipeline.handle(request());
    // Assert — the response carries a direct abort that flips the fetch signal
    expect(response.onClientDisconnect).toBeDefined();
    expect(captured?.signal.aborted).toBe(false);
    response.onClientDisconnect?.();
    expect(captured?.signal.aborted).toBe(true);
  });

  it('wires onClientDisconnect on the buffered (non-stream) path too', async () => {
    // Arrange — non-stream request, upstream body fully collected by the pipeline
    let captured: AbortController | undefined;
    const port = {
      fetch: async (): Promise<UpstreamResponse> => {
        const controller = new AbortController();
        captured = controller;
        return { status: 200, headers: {}, body: fromChunks([OAI_JSON]) };
      },
    };
    const pipeline = createPipeline(makeDeps(port));
    // Act
    const response = await pipeline.handle(request(ANTHROPIC_BODY));
    // Assert — field is wired for uniformity while the handle is in scope
    // (a no-op here: the buffered body is already fully collected)
    expect(response.status).toBe(200);
    expect(response.onClientDisconnect).toBeDefined();
    expect(captured).toBeDefined();
    expect(() => response.onClientDisconnect?.()).not.toThrow();
  });
});

describe('pipeline handle — client disconnect status accuracy (A)', () => {
  /**
   * Stalled upstream: the read never yields; it rejects like an aborted fetch
   * once the controller aborts. The rejection promise is created eagerly (an
   * 'abort' listener registered after abort() would never fire) and honours
   * an already-aborted signal.
   */
  function stalledUpstreamPort(): {
    port: { fetch: () => Promise<UpstreamResponse> };
    captured: () => AbortController | undefined;
  } {
    let controller: AbortController | undefined;
    return {
      captured: () => controller,
      port: {
        fetch: async (): Promise<UpstreamResponse> => {
          const local = new AbortController();
          controller = local;
          const aborted = new Promise<never>((_, reject) => {
            const abortError = (): void =>
              reject(new Error('This operation was aborted'));
            if (local.signal.aborted) {
              abortError();
              return;
            }
            local.signal.addEventListener('abort', abortError, { once: true });
          });
          return {
            status: 200,
            headers: {},
            body: (async function* stalled(): AsyncGenerator<string> {
              await aborted;
              yield ''; // unreachable: the await above only settles via rejection
            })(),
            abort: () => local.abort(),
          };
        },
      },
    };
  }

  it('records 499 with no error frame when the client disconnects mid-stream', async () => {
    // Arrange — stalled upstream whose read rejects only via our own abort
    const { port: observability, ended } = fakeObservability();
    const upstream = stalledUpstreamPort();
    const pipeline = createPipeline(
      makeDeps(upstream.port, undefined, undefined, undefined, [], observability),
    );
    // Act — the client hangs up: the B2.1 handler flips the flag, then aborts
    const response = await pipeline.handle(request());
    response.onClientDisconnect?.();
    const text = await readBody(response.body);
    // Assert — client-closed convention, no server 500, no futile error frame
    expect(upstream.captured()?.signal.aborted).toBe(true);
    expect(ended).toEqual([499]);
    expect(text).toBe('');
  });

  it('still records 500 with an error frame when the upstream stream dies on its own', async () => {
    // Arrange — the upstream aborts WITHOUT a client disconnect having fired
    const { port: observability, ended } = fakeObservability();
    /** One chunk, then death: an upstream-side abort, not a client disconnect. */
    async function* upstreamDiesAlone(): AsyncGenerator<string> {
      for (const chunk of OAI_SSE.slice(0, 1)) {
        yield chunk;
      }
      throw new Error('This operation was aborted');
    }
    const port = {
      fetch: async (): Promise<UpstreamResponse> => ({
        status: 200,
        headers: {},
        body: upstreamDiesAlone(),
      }),
    };
    const pipeline = createPipeline(
      makeDeps(port, undefined, undefined, undefined, [], observability),
    );
    // Act
    const text = await readBody((await pipeline.handle(request())).body);
    // Assert — an upstream-side abort is a genuine failure: 500 + error frame
    expect(ended).toEqual([500]);
    expect(text).toContain('plugin_stream_error');
  });
});

describe('pipeline handle — request-time format-skip warn dedupe (F)', () => {
  it('warns once per (plugin, format) across repeated requests', async () => {
    // Arrange — anthropic-messages-only plugin routed to an openai-chat provider
    const anthropicOnly: ProxyPlugin = {
      name: 'anthropicOnlySkipOnce',
      reservedKeys: { 'anthropic-messages': ['cache_control'] },
    };
    const upstream = fakeFetch(200, OAI_SSE);
    const pipeline = createPipeline(
      makeDeps(upstream.port, new Map([['anthropicOnlySkipOnce', anthropicOnly]])),
    );
    // Act — two full requests through the incompatible route
    await readBody((await pipeline.handle(request())).body);
    await readBody((await pipeline.handle(request())).body);
    // Assert — the skip happens per request, the warn only on the first
    const skipWarns = logger.warns.filter(message =>
      message.includes('anthropicOnlySkipOnce'),
    );
    expect(skipWarns).toHaveLength(1);
  });
});
