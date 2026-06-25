// src/proxy/cache-logging.test.ts
import { describe, expect, it } from 'vitest';
import { buildUpstreamResponseWithLogging } from './cache-logging.js';
import { Observability } from './observability/observability.js';
import { SessionTracker } from './observability/session-tracker.js';
import type { CacheObservation, RequestContext } from './observability/types.js';

const reqCtx: RequestContext = {
  reqId: 'r1',
  model: 'glm-4.5-air',
  sessionId: 's1',
  toolsCount: 130,
  requestType: 'main',
};

function streamResponse(sse: string): Response {
  return new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('buildUpstreamResponseWithLogging', () => {
  it('classifies a streamed SSE response and dispatches to sinks', async () => {
    // Arrange — a sink that captures the emitted observation
    let got: CacheObservation | undefined;
    const obs = new Observability(
      new SessionTracker({ maxEntries: 8, ttlMs: 1000 }),
      [
        {
          emit: o => {
            got = o;
          },
        },
      ],
      80,
    );

    const sse =
      `data: ${JSON.stringify({ message: { usage: { input_tokens: 234, cache_read_input_tokens: 48640 } } })}\n\n` +
      `data: ${JSON.stringify({ id: 'gen-1', openrouter_metadata: { strategy: 'direct', attempt: 1, endpoints: { available: [{ provider: 'Novita', selected: true }] } } })}\n\n` +
      `data: [DONE]\n\n`;

    // Act
    const res = buildUpstreamResponseWithLogging(streamResponse(sse), 'POST', {
      reqCtx,
      observability: obs,
    });
    // drain the stream so flush() runs
    await res.text();

    // Assert — usage extracted, classified as HIT, routing parsed
    expect(got?.outcome.label).toBe('HIT');
    expect(got?.routing?.provider).toBe('Novita');
    expect(got?.status).toBe(200);
  });
});
