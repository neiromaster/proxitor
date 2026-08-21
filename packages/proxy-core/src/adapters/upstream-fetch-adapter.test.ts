import { describe, expect, test } from 'vitest';
import { createFetchUpstream } from './upstream-fetch-adapter.js';

const sseResponse = (chunks: string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Extra': 'v' } },
  );

describe('createFetchUpstream', () => {
  test('decodes the upstream body to string chunks and lowercases headers', async () => {
    // Arrange
    const adapter = createFetchUpstream({
      fetchImpl: async () => sseResponse(['a', 'b']),
    });
    // Act
    const upstream = await adapter.fetch({
      url: 'https://u.example/v1',
      method: 'POST',
      headers: {},
      body: '{}',
    });
    const chunks: string[] = [];
    for await (const chunk of upstream.body) chunks.push(chunk);
    // Assert
    expect(chunks).toEqual(['a', 'b']);
    expect(upstream.status).toBe(200);
    expect(upstream.headers['content-type']).toBe('text/event-stream');
    expect(upstream.headers['x-extra']).toBe('v');
  });

  test('multibyte UTF-8 split across chunks stays intact', async () => {
    // Arrange — 'héllo' with é split across two byte chunks
    const bytes = new TextEncoder().encode('héllo');
    const adapter = createFetchUpstream({
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(bytes.slice(0, 2));
              c.enqueue(bytes.slice(2));
              c.close();
            },
          }),
        ),
    });
    // Act
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    let text = '';
    for await (const chunk of upstream.body) text += chunk;
    // Assert
    expect(text).toBe('héllo');
  });

  test('early return aborts the upstream request (stop iterating = abort, D8)', async () => {
    // Arrange
    let capturedSignal: AbortSignal | null | undefined;
    const adapter = createFetchUpstream({
      fetchImpl: async (_url, init) => {
        capturedSignal = init?.signal;
        return sseResponse(['a', 'b', 'c']);
      },
    });
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    // Act — consume one chunk, then stop
    const iterator = upstream.body[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    // Assert
    expect(capturedSignal?.aborted).toBe(true);
  });

  test('clean completion also runs the abort (no-op) without failing the stream', async () => {
    const adapter = createFetchUpstream({ fetchImpl: async () => sseResponse(['a']) });
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    let text = '';
    for await (const chunk of upstream.body) text += chunk;
    expect(text).toBe('a');
  });
});
