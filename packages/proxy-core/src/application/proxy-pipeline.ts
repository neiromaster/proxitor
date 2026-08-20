import type {
  CanonicalError,
  CanonicalEvent,
  CanonicalRequest,
  ClockPort,
  LoggerPort,
  PluginContext,
  RandomPort,
  ShortCircuit,
  WireFormat,
} from '@proxitor/plugin-api';
import { ENDPOINT_PATHS } from '@proxitor/plugin-api';
import type { RouteResolution, RoutingTable } from '../domain/index.js';
import {
  classifyPath,
  endpointUrl,
  MODELS_PATH,
  RoutingConfigError,
  RoutingError,
} from '../domain/index.js';
import { getFormat } from '../formats/index.js';
import { FormatError } from '../formats/shared/format-error.js';
import type {
  FormatAdapter,
  StreamEncodeOptions,
  StreamEncoder,
} from '../formats/shared/stream-codec.js';
import type { CredentialResolverPort } from './credentials.js';
import { resolveAuthHeader } from './credentials.js';
import type { ActivePlugin, PluginManager } from './plugin-manager.js';
import type { UpstreamFetchPort, UpstreamResponse } from './upstream-fetch.js';
import { buildUpstreamHeaders } from './upstream-headers.js';

/** Inbound request as the pipeline sees it; the M5 hono adapter builds this. */
export type PipelineRequest = {
  /** Normalized, query-stripped path (domain contract: `classifyPath` expects exactly this). */
  readonly path: string;
  readonly method: 'POST' | 'GET';
  /** Lowercased client headers. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

/** Outbound response: status + headers + a pull-model string stream. */
export type PipelineResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<string>;
};

/** Everything the pipeline needs injected; the M5 composition root assembles it. */
export type PipelineDeps = {
  readonly table: RoutingTable;
  readonly manager: PluginManager;
  readonly fetch: UpstreamFetchPort;
  readonly credentials: CredentialResolverPort;
  readonly logger: LoggerPort;
  readonly clock: ClockPort;
  readonly random: RandomPort;
};

/** A request that passed decode, routing, and the onRequest chain, ready for upstream. */
export type ReadyRequest = {
  readonly inbound: WireFormat;
  readonly resolution: RouteResolution;
  readonly ir: CanonicalRequest;
  readonly active: readonly ActivePlugin[];
  readonly requestId: string;
};

export type PrepareOutcome =
  | { readonly kind: 'shortCircuit'; readonly response: PipelineResponse }
  | { readonly kind: 'error'; readonly response: PipelineResponse }
  | { readonly kind: 'ready'; readonly ready: ReadyRequest };

/** Map any pipeline-stage exception to its CanonicalError (spec §10). */
export function toCanonicalError(error: unknown): CanonicalError {
  if (error instanceof RoutingError) {
    return { type: 'routing_error', message: error.message, status: error.status };
  }
  if (error instanceof FormatError) {
    return error.canonical;
  }
  if (error instanceof RoutingConfigError) {
    // D7: request-time activation/config failures; M5 moves them to load time.
    return { type: 'plugin_config_error', message: error.message, status: 500 };
  }
  return {
    type: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    status: 500,
  };
}

async function* singleChunk(text: string): AsyncGenerator<string> {
  yield text;
}

async function* fromArray(
  events: readonly CanonicalEvent[],
): AsyncGenerator<CanonicalEvent> {
  for (const event of events) {
    yield event;
  }
}

function pluginCtx(
  ap: ActivePlugin,
  requestId: string,
  deps: PipelineDeps,
): PluginContext {
  return {
    requestId,
    logger: deps.logger,
    clock: deps.clock,
    random: deps.random,
    config: ap.config,
  };
}

/** Pre-200 error: CanonicalError status + the client's wire-error body (§10, D2). */
function errorResponse(inbound: WireFormat, error: CanonicalError): PipelineResponse {
  return {
    status: error.status,
    headers: { 'content-type': 'application/json' },
    body: singleChunk(getFormat(inbound).encodeError(error)),
  };
}

/** Spec §7: an onError exception is logged; the current (original) error survives. */
async function runErrorHooks(
  active: readonly ActivePlugin[],
  error: CanonicalError,
  deps: PipelineDeps,
  requestId: string,
): Promise<CanonicalError> {
  let current = error;
  for (const ap of active) {
    if (ap.plugin.onError === undefined) {
      continue;
    }
    try {
      current = await ap.plugin.onError(pluginCtx(ap, requestId, deps), current);
    } catch (hookError) {
      deps.logger.warn('plugin onError hook failed; keeping current error', {
        requestId,
        plugin: ap.name,
        error: hookError instanceof Error ? hookError.message : String(hookError),
      });
    }
  }
  return current;
}

/** Observer pass: onEvent sees every delivered event AFTER transforms (spec §7). */
async function* observeEvents(
  events: AsyncIterable<CanonicalEvent>,
  active: readonly ActivePlugin[],
  deps: PipelineDeps,
  requestId: string,
): AsyncGenerator<CanonicalEvent> {
  for await (const event of events) {
    // Mid-stream error events run the onError chain before encoding (§7, §10).
    const delivered: CanonicalEvent =
      event.type === 'error'
        ? {
            type: 'error',
            error: await runErrorHooks(active, event.error, deps, requestId),
          }
        : event;
    for (const ap of active) {
      if (ap.plugin.onEvent === undefined) {
        continue;
      }
      try {
        await ap.plugin.onEvent(pluginCtx(ap, requestId, deps), delivered);
      } catch (hookError) {
        // Observer failures never break the response stream (spec §7).
        deps.logger.warn('plugin onEvent observer failed', {
          requestId,
          plugin: ap.name,
          error: hookError instanceof Error ? hookError.message : String(hookError),
        });
      }
    }
    yield delivered;
  }
}

/** Mid-iteration failures: upstream decode errors keep their canonical form, the rest are plugin_stream_error (D8). */
function iterationError(error: unknown): CanonicalError {
  if (error instanceof FormatError) {
    return error.canonical;
  }
  return {
    type: 'plugin_stream_error',
    message: `stream pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
    status: 500,
  };
}

/** Encode canonical events to the client's SSE, with the D8 clean-close error path. */
async function* encodeClientStream(
  events: AsyncIterable<CanonicalEvent>,
  encoder: StreamEncoder,
  active: readonly ActivePlugin[],
  deps: PipelineDeps,
  requestId: string,
): AsyncGenerator<string> {
  try {
    for await (const event of events) {
      const chunk = encoder.push(event);
      if (chunk.length > 0) {
        yield chunk;
      }
    }
    const done = encoder.end();
    if (done.length > 0) {
      yield done;
    }
  } catch (error) {
    const canonical = await runErrorHooks(active, iterationError(error), deps, requestId);
    const chunk = encoder.push({ type: 'error', error: canonical });
    if (chunk.length > 0) {
      yield chunk;
    }
    const done = encoder.end();
    if (done.length > 0) {
      yield done;
    }
  }
}

function isShortCircuit(value: CanonicalRequest | ShortCircuit): value is ShortCircuit {
  return (
    typeof value === 'object' &&
    value !== null &&
    'shortCircuit' in value &&
    value.shortCircuit === true
  );
}

async function shortCircuitResponse(
  inbound: WireFormat,
  sc: ShortCircuit,
  ir: CanonicalRequest,
  active: readonly ActivePlugin[],
  deps: PipelineDeps,
  requestId: string,
): Promise<PipelineResponse> {
  const adapter = getFormat(inbound);
  const encodeOptions: StreamEncodeOptions = {
    model: ir.model.logical,
    clock: deps.clock,
    random: deps.random,
  };
  if (sc.error !== undefined) {
    // Spec §7: a short-circuit error does NOT run onError hooks.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(sc.headers ?? {}),
    };
    return {
      status: sc.status,
      headers,
      body: singleChunk(adapter.encodeError(sc.error)),
    };
  }
  const events = observeEvents(fromArray(sc.events ?? []), active, deps, requestId);
  if (ir.stream) {
    const encoder = adapter.createStreamEncoder(encodeOptions);
    const headers: Record<string, string> = {
      'content-type': 'text/event-stream',
      ...(sc.headers ?? {}),
    };
    return {
      status: sc.status,
      headers,
      body: encodeClientStream(events, encoder, active, deps, requestId),
    };
  }
  const collected: CanonicalEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  // I1: If any collected event is an error event, render it as the response.
  const errorEvent = collected.find(e => e.type === 'error');
  if (errorEvent !== undefined && errorEvent.type === 'error') {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(sc.headers ?? {}),
    };
    return {
      status: errorEvent.error.status,
      headers,
      body: singleChunk(adapter.encodeError(errorEvent.error)),
    };
  }
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(sc.headers ?? {}),
    };
    return {
      status: sc.status,
      headers,
      body: singleChunk(adapter.encodeResponse(collected, encodeOptions)),
    };
  } catch (error) {
    const canonical =
      error instanceof FormatError ? error.canonical : iterationError(error);
    return errorResponse(inbound, canonical);
  }
}

/**
 * §9 steps 1–7: classify → decode → n-gate → resolve → activate → onRequest chain
 * → ShortCircuit or ready. Upstream transport is Task 5's runUpstream.
 */
export async function prepareUpstream(
  request: PipelineRequest,
  deps: PipelineDeps,
): Promise<PrepareOutcome> {
  const requestId = deps.random.uuid();

  let inbound: WireFormat;
  try {
    const classified = classifyPath(request.path);
    if (classified === MODELS_PATH) {
      // handle() (Task 6) intercepts GET /v1/models earlier; a POST here is rejected (D5 shape).
      return {
        kind: 'error',
        response: errorResponse('openai-chat', {
          type: 'invalid_request_error',
          message: `${MODELS_PATH} supports GET only`,
          status: 405,
        }),
      };
    }
    inbound = classified;
  } catch (error) {
    // D5: before classification the client's format is unknowable — openai shape.
    return {
      kind: 'error',
      response: errorResponse('openai-chat', toCanonicalError(error)),
    };
  }

  let ir: CanonicalRequest;
  try {
    ir = getFormat(inbound).decodeRequest(request.body);
  } catch (error) {
    // D6: decode precedes routing, so no plugins are active — the onError
    // trigger point exists but observes nothing.
    return { kind: 'error', response: errorResponse(inbound, toCanonicalError(error)) };
  }

  if ((ir.params.n ?? 1) > 1) {
    // D13: each logical request maps to exactly one upstream call.
    return {
      kind: 'error',
      response: errorResponse(inbound, {
        type: 'invalid_request_error',
        message:
          'params.n > 1 is not supported: each request maps to exactly one upstream call',
        status: 400,
      }),
    };
  }

  let resolution: RouteResolution;
  try {
    resolution = deps.table.resolve(ir.model.logical, request.path);
  } catch (error) {
    return { kind: 'error', response: errorResponse(inbound, toCanonicalError(error)) };
  }

  let active: readonly ActivePlugin[];
  try {
    active = deps.manager.activate(resolution.plugins);
  } catch (error) {
    // D7: request-time activation failures are 500s.
    return { kind: 'error', response: errorResponse(inbound, toCanonicalError(error)) };
  }

  for (const ap of active) {
    if (ap.plugin.onRequest === undefined) {
      continue;
    }
    let result: CanonicalRequest | ShortCircuit;
    try {
      result = await ap.plugin.onRequest(pluginCtx(ap, requestId, deps), ir);
    } catch (error) {
      // Spec §7: a failing request hook is skipped and logged; the chain continues.
      deps.logger.warn('plugin onRequest hook failed; skipping plugin', {
        requestId,
        plugin: ap.name,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (isShortCircuit(result)) {
      return {
        kind: 'shortCircuit',
        response: await shortCircuitResponse(
          inbound,
          result,
          ir,
          active,
          deps,
          requestId,
        ),
      };
    }
    ir = result;
  }

  return { kind: 'ready', ready: { inbound, resolution, ir, active, requestId } };
}

export type ProxyPipeline = {
  handle(request: PipelineRequest): Promise<PipelineResponse>;
};

/** The §9 12-step flow, entry point for the M5 hono adapter. */
export function createPipeline(deps: PipelineDeps): ProxyPipeline {
  return {
    handle: async request => {
      try {
        if (request.path === MODELS_PATH) {
          // D10: synthesized locally from the routing table; GET only.
          if (request.method !== 'GET') {
            return errorResponse('openai-chat', {
              type: 'invalid_request_error',
              message: `${MODELS_PATH} supports GET only`,
              status: 405,
            });
          }
          return modelsResponse(deps.table);
        }
        if (isModelLessPath(request)) {
          return runModelLess(request, deps);
        }
        const outcome = await prepareUpstream(request, deps);
        if (outcome.kind !== 'ready') {
          return outcome.response;
        }
        return await runUpstream(outcome.ready, request, deps);
      } catch (error) {
        // I2: Terminal exception boundary - any throw escaping the pipeline maps to an error response.
        return errorResponse('openai-chat', toCanonicalError(error));
      }
    },
  };
}

/** D10: the model listing is a synthesis, not a translation — openai list shape for every client. */
function modelsResponse(table: RoutingTable): PipelineResponse {
  const data = table
    .listModels()
    .map(id => ({ id, object: 'model', owned_by: 'proxitor' }));
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: singleChunk(JSON.stringify({ object: 'list', data })),
  };
}

/** D12: /v1/* POST endpoints outside the classified set route raw to defaultProvider. */
function isModelLessPath(request: PipelineRequest): boolean {
  if (request.method !== 'POST' || !request.path.startsWith('/v1/')) {
    return false;
  }
  return (
    request.path !== ENDPOINT_PATHS['anthropic-messages'] &&
    request.path !== ENDPOINT_PATHS['openai-chat'] &&
    request.path !== '/v1/responses' // deferred format → 501, never a passthrough
  );
}

/** D12: raw byte passthrough — no codecs, no plugin hooks, upstream answer verbatim. */
async function runModelLess(
  request: PipelineRequest,
  deps: PipelineDeps,
): Promise<PipelineResponse> {
  let resolution: RouteResolution;
  try {
    resolution = deps.table.resolveModelLess(request.path);
  } catch (error) {
    // No defaultProvider (or unreachable config break) → openai-shape error (D5).
    return errorResponse('openai-chat', toCanonicalError(error));
  }
  const provider = resolution.provider;
  const authHeader = resolveAuthHeader(provider.auth, deps.credentials);
  const headers = buildUpstreamHeaders({
    clientHeaders: request.headers,
    provider,
    authHeader,
    outboundHeaders: undefined,
    streaming: false,
  });
  // M3: Collapse /v1/v1 to /v1 for baseUrl suffixed with /v1 (consistent with domain/provider.ts endpointUrl).
  const url = `${provider.baseUrl.replace(/\/+$/, '')}${request.path}`.replace(
    /\/v1\/v1(?=\/)/g,
    '/v1',
  );
  let upstream: UpstreamResponse;
  try {
    upstream = await deps.fetch.fetch({
      url,
      method: 'POST',
      headers,
      body: request.body,
    });
  } catch (error) {
    return errorResponse('openai-chat', {
      type: 'upstream_unreachable',
      message: `upstream ${provider.id} unreachable: ${messageOf(error)}`,
      status: 502,
    });
  }
  const contentType = upstream.headers['content-type'] ?? 'application/json';
  return {
    status: upstream.status,
    headers: { 'content-type': contentType },
    body: upstream.body, // raw passthrough — never re-decoded
  };
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function collectBody(chunks: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) {
    text += chunk;
  }
  return text;
}

async function* decodeUpstreamEvents(
  adapter: FormatAdapter,
  body: AsyncIterable<string>,
): AsyncGenerator<CanonicalEvent> {
  const decoder = adapter.createStreamDecoder();
  for await (const chunk of body) {
    for (const event of decoder.push(chunk)) {
      yield event;
    }
  }
  for (const event of decoder.end()) {
    yield event;
  }
}

/**
 * D19: the first plugin in the effective list is the OUTERMOST transform —
 * compose in reverse so each later plugin wraps the earlier ones.
 */
function applyStreamTransforms(
  source: AsyncIterable<CanonicalEvent>,
  active: readonly ActivePlugin[],
  deps: PipelineDeps,
  requestId: string,
): AsyncIterable<CanonicalEvent> {
  let stream = source;
  // Reverse iteration: first plugin becomes outermost wrapper
  for (const ap of [...active].reverse()) {
    if (ap.plugin.transformStream === undefined) {
      continue;
    }
    stream = ap.plugin.transformStream(pluginCtx(ap, requestId, deps), stream);
  }
  return stream;
}

/** §9 steps 8–12 for the model-routed path. */
async function runUpstream(
  ready: ReadyRequest,
  request: PipelineRequest,
  deps: PipelineDeps,
): Promise<PipelineResponse> {
  const { inbound, resolution, ir, active, requestId } = ready;
  const provider = resolution.provider;
  const physical = resolution.physicalModel;
  if (physical === undefined) {
    // Unreachable on the model-routed path (domain contract); total-code guard.
    return errorResponse(inbound, {
      type: 'internal_error',
      message: 'resolved route has no physical model',
      status: 500,
    });
  }

  const outboundAdapter = getFormat(resolution.outboundFormat);
  const outboundIr: CanonicalRequest = {
    ...ir,
    model: { logical: ir.model.logical, physical }, // D9
  };
  const body = outboundAdapter.encodeRequest(outboundIr, {
    maxTokensField: provider.maxTokensField,
  });

  const authHeader = resolveAuthHeader(provider.auth, deps.credentials);
  const headers = buildUpstreamHeaders({
    clientHeaders: request.headers,
    provider,
    authHeader,
    outboundHeaders: ir.outboundHeaders,
    streaming: ir.stream,
  });

  let upstream: UpstreamResponse;
  try {
    upstream = await deps.fetch.fetch({
      url: endpointUrl(provider.baseUrl, provider.wireFormat),
      method: 'POST',
      headers,
      body,
    });
  } catch (error) {
    return errorResponse(
      inbound,
      await runErrorHooks(
        active,
        {
          type: 'upstream_unreachable',
          message: `upstream ${provider.id} unreachable: ${messageOf(error)}`,
          status: 502,
        },
        deps,
        requestId,
      ),
    );
  }

  if (upstream.status < 200 || upstream.status >= 300) {
    const text = await collectBody(upstream.body);
    let providerError: unknown = text;
    try {
      providerError = JSON.parse(text);
    } catch {
      providerError = text; // non-JSON error body — keep raw text
    }
    return errorResponse(
      inbound,
      await runErrorHooks(
        active,
        {
          type: 'upstream_error',
          message: `upstream ${provider.id} responded ${upstream.status}`,
          status: upstream.status,
          providerError,
        },
        deps,
        requestId,
      ),
    );
  }

  return streamResponse(ready, upstream, outboundAdapter, deps);
}

async function streamResponse(
  ready: ReadyRequest,
  upstream: UpstreamResponse,
  outboundAdapter: FormatAdapter,
  deps: PipelineDeps,
): Promise<PipelineResponse> {
  const { inbound, ir, active, requestId } = ready;
  const inboundAdapter = getFormat(inbound);
  const encodeOptions: StreamEncodeOptions = {
    model: ir.model.logical, // D9: the client sees its own logical name
    clock: deps.clock,
    random: deps.random,
  };

  if (!ir.stream) {
    // D11: non-streaming still flows through the event model — buffered both sides.
    let events: CanonicalEvent[];
    try {
      events = outboundAdapter.decodeResponse(await collectBody(upstream.body));
    } catch (error) {
      const canonical =
        error instanceof FormatError ? error.canonical : iterationError(error);
      return errorResponse(
        inbound,
        await runErrorHooks(active, canonical, deps, requestId),
      );
    }
    // D9: transform message_start events to use the logical model name
    events = events.map(event => {
      if (event.type === 'message_start') {
        return { ...event, model: ir.model.logical };
      }
      return event;
    });
    const observed = observeEvents(
      applyStreamTransforms(fromArray(events), active, deps, requestId),
      active,
      deps,
      requestId,
    );
    const collected: CanonicalEvent[] = [];
    for await (const event of observed) {
      collected.push(event);
    }
    // I1: If any collected event is an error event, render it as the response.
    const errorEvent = collected.find(e => e.type === 'error');
    if (errorEvent !== undefined && errorEvent.type === 'error') {
      return errorResponse(inbound, errorEvent.error);
    }
    try {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: singleChunk(inboundAdapter.encodeResponse(collected, encodeOptions)),
      };
    } catch (error) {
      const canonical =
        error instanceof FormatError ? error.canonical : iterationError(error);
      return errorResponse(
        inbound,
        await runErrorHooks(active, canonical, deps, requestId),
      );
    }
  }

  const source = decodeUpstreamEvents(outboundAdapter, upstream.body);
  // Transform message_start events to use the logical model name (D9)
  const withLogicalModel = async function* (
    events: AsyncIterable<CanonicalEvent>,
  ): AsyncGenerator<CanonicalEvent> {
    for await (const event of events) {
      if (event.type === 'message_start') {
        yield { ...event, model: ir.model.logical };
        continue;
      }
      yield event;
    }
  };
  const withLogicalModelApplied = withLogicalModel(source);
  const transformed = applyStreamTransforms(
    withLogicalModelApplied,
    active,
    deps,
    requestId,
  );
  const observed = observeEvents(transformed, active, deps, requestId);
  const encoder = inboundAdapter.createStreamEncoder(encodeOptions);
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: encodeClientStream(observed, encoder, active, deps, requestId),
  };
}
