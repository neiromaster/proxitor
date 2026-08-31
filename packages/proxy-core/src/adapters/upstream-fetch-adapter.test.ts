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

  test('direct abort() fires the fetch signal with no chunks consumed (B2.1)', async () => {
    // Arrange — hung upstream: body never yields and never closes
    let capturedSignal: AbortSignal | null | undefined;
    const adapter = createFetchUpstream({
      fetchImpl: async (_url, init) => {
        capturedSignal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
        });
      },
    });
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    expect(upstream.abort).toBeDefined();
    // Act — abort the handle directly, without pulling a single chunk
    upstream.abort?.();
    // Assert — the fetch signal is aborted regardless of the stalled body
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

  test('consumer throws mid-iteration still runs abort in finally', async () => {
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
    // Act - consumer throws during iteration
    const iterator = upstream.body[Symbol.asyncIterator]();
    await iterator.next();
    try {
      for await (const chunk of upstream.body) {
        if (chunk === 'b') {
          throw new Error('Consumer error');
        }
      }
    } catch {
      // Expected consumer error
    }
    // Assert - abort still ran despite consumer throw
    expect(capturedSignal?.aborted).toBe(true);
  });

  test('fetchImpl rejection propagates normally to caller', async () => {
    // Arrange
    const adapter = createFetchUpstream({
      fetchImpl: async () => {
        throw new Error('Network error');
      },
    });
    // Act & Assert
    await expect(
      adapter.fetch({
        url: 'https://u/',
        method: 'POST',
        headers: {},
        body: '',
      }),
    ).rejects.toThrow('Network error');
  });

  test('upstream 204-style null body completes cleanly with no chunks', async () => {
    // Arrange
    const adapter = createFetchUpstream({
      fetchImpl: async () => new Response(null, { status: 204, headers: {} }),
    });
    // Act
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    const chunks: string[] = [];
    for await (const chunk of upstream.body) chunks.push(chunk);
    // Assert
    expect(chunks).toEqual([]);
    expect(upstream.status).toBe(204);
  });

  test('upstream 4xx/5xx status with body decodes normally', async () => {
    // Arrange
    const adapter = createFetchUpstream({
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('error'));
              controller.close();
            },
          }),
          { status: 500, headers: { 'Content-Type': 'text/plain' } },
        ),
    });
    // Act
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    const chunks: string[] = [];
    for await (const chunk of upstream.body) chunks.push(chunk);
    // Assert
    expect(chunks).toEqual(['error']);
    expect(upstream.status).toBe(500);
    expect(upstream.headers['content-type']).toBe('text/plain');
  });

  test('duplicate response header names join with comma-space per HTTP spec', async () => {
    // Arrange - Response with duplicate X-Custom headers
    const adapter = createFetchUpstream({
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
          headers: [
            ['X-Custom', 'first'],
            ['X-Custom', 'second'],
            ['Content-Type', 'text/plain'],
          ],
        }),
    });
    // Act
    const upstream = await adapter.fetch({
      url: 'https://u/',
      method: 'POST',
      headers: {},
      body: '',
    });
    // Assert - Headers API joins duplicates with ", " (HTTP spec compliant)
    expect(upstream.headers['x-custom']).toBe('first, second');
    expect(upstream.headers['content-type']).toBe('text/plain');
  });
});
