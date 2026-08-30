import { describe, expect, it } from 'vitest';
import { createRoutingTable } from '../domain/index.js';
import { createBuiltInPluginRegistry } from '../plugins/built-in/index.js';
import type { ObservabilityPort, ObservationContext } from './observability.js';
import { createPluginManager } from './plugin-manager.js';
import type { PipelineDeps } from './proxy-pipeline.js';
import { createPipeline } from './proxy-pipeline.js';
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

function fakeObservability() {
  const begun: ObservationContext[] = [];
  const port: ObservabilityPort = {
    begin(ctx) {
      begun.push(ctx);
      return { onEvent: () => {}, captureOutbound: () => {}, end: () => {} };
    },
    reconfigure: () => {},
  };
  return { port, begun };
}

function makeDeps(
  fetchPort: PipelineDeps['fetch'],
  observability: ObservabilityPort,
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
          plugins: ['session-id'],
        },
      },
      models: [{ match: 'claude-*', provider: 'ant', modelId: 'claude-real' }],
      defaultProvider: 'ant',
    }),
    manager: createPluginManager({ plugins: createBuiltInPluginRegistry(), logger }),
    fetch: fetchPort,
    credentials: {
      resolve: (ref: unknown) => (typeof ref === 'string' ? ref : 'resolved'),
    },
    logger,
    clock: { now: () => 0 },
    random: { uuid: () => 'req-1' },
    observability,
  };
}

const BODY = JSON.stringify({
  model: 'claude-sonnet-5',
  max_tokens: 64,
  stream: false,
  system: [{ type: 'text', text: 'sys' }],
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

async function handleWithSessionHeaders(
  headers: Readonly<Record<string, string>>,
): Promise<{ wireSessionId: unknown; observedSessionId: unknown }> {
  // Arrange
  const { calls, port } = fakeFetch(200, [UPSTREAM_JSON]);
  const { port: observability, begun } = fakeObservability();
  const pipeline = createPipeline(makeDeps(port, observability));

  // Act
  const response = await pipeline.handle({
    path: '/v1/messages',
    method: 'POST',
    headers,
    body: BODY,
  });
  let clientBody = '';
  for await (const chunk of response.body) clientBody += chunk;

  if (response.status !== 200) {
    throw new Error(`pipeline failed: ${clientBody}`);
  }
  return {
    wireSessionId: calls[0]?.headers['x-session-id'],
    observedSessionId: begun[0]?.sessionId,
  };
}

describe('pipeline stamps the client session hint (B3.2)', () => {
  it('x-claude-code-session-id wins and lands on the wire + observation verbatim', async () => {
    // Arrange / Act
    const { wireSessionId, observedSessionId } = await handleWithSessionHeaders({
      'x-claude-code-session-id': 'abc',
    });

    // Assert
    expect(wireSessionId).toBe('abc');
    expect(observedSessionId).toBe('abc');
  });

  it('x-session-id alone is honored when the client header is absent', async () => {
    // Arrange / Act
    const { wireSessionId, observedSessionId } = await handleWithSessionHeaders({
      'x-session-id': 'xyz',
    });

    // Assert
    expect(wireSessionId).toBe('xyz');
    expect(observedSessionId).toBe('xyz');
  });

  it('x-claude-code-session-id takes precedence when both headers are sent', async () => {
    // Arrange / Act
    const { wireSessionId, observedSessionId } = await handleWithSessionHeaders({
      'x-claude-code-session-id': 'abc',
      'x-session-id': 'xyz',
    });

    // Assert
    expect(wireSessionId).toBe('abc');
    expect(observedSessionId).toBe('abc');
  });

  it('falls back to the content fingerprint when no session header is sent', async () => {
    // Arrange / Act
    const { wireSessionId, observedSessionId } = await handleWithSessionHeaders({});

    // Assert
    expect(wireSessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(observedSessionId).toBe(wireSessionId);
  });

  it('treats an empty session header value as absent (fingerprint path)', async () => {
    // Arrange / Act
    const { wireSessionId, observedSessionId } = await handleWithSessionHeaders({
      'x-claude-code-session-id': '',
    });

    // Assert
    expect(wireSessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(observedSessionId).toBe(wireSessionId);
  });
});
