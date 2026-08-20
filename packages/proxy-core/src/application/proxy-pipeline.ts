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
import type { RouteResolution, RoutingTable } from '../domain/index.js';
import {
  classifyPath,
  MODELS_PATH,
  RoutingConfigError,
  RoutingError,
} from '../domain/index.js';
import { getFormat } from '../formats/index.js';
import { FormatError } from '../formats/shared/format-error.js';
import type {
  StreamEncodeOptions,
  StreamEncoder,
} from '../formats/shared/stream-codec.js';
import type { CredentialResolverPort } from './credentials.js';
import type { ActivePlugin, PluginManager } from './plugin-manager.js';
import type { UpstreamFetchPort } from './upstream-fetch.js';

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
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(sc.headers ?? {}),
  };
  return {
    status: sc.status,
    headers,
    body: singleChunk(adapter.encodeResponse(collected, encodeOptions)),
  };
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
