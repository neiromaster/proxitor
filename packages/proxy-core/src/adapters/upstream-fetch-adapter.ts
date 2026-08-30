import type {
  UpstreamFetchPort,
  UpstreamRequest,
  UpstreamResponse,
} from '../application/upstream-fetch.js';

/** UpstreamFetchPort over global fetch; owns the abort lifecycle (D8/D-M5a-2). */
export function createFetchUpstream(deps?: {
  fetchImpl?: typeof fetch;
}): UpstreamFetchPort {
  const doFetch = deps?.fetchImpl ?? fetch;

  return {
    fetch: async (request: UpstreamRequest): Promise<UpstreamResponse> => {
      const controller = new AbortController();
      const upstream = await doFetch(request.url, {
        method: 'POST',
        headers: { ...request.headers },
        body: request.body,
        signal: controller.signal,
      });

      async function* decoded(): AsyncGenerator<string> {
        try {
          if (upstream.body !== null && typeof upstream.body.getReader === 'function') {
            yield* readStream(upstream.body);
          }
        } finally {
          // Stop iterating = abort: client disconnect propagates upstream; no-op after clean completion.
          controller.abort();
        }
      }

      async function* readStream(
        stream: ReadableStream<Uint8Array>,
      ): AsyncGenerator<string> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();

        for await (const chunk of readAllChunks(reader)) {
          yield decoder.decode(chunk, { stream: true });
        }

        const tail = decoder.decode();
        if (tail.length > 0) {
          yield tail;
        }
      }

      async function* readAllChunks(
        reader: ReadableStreamDefaultReader<Uint8Array>,
      ): AsyncGenerator<Uint8Array> {
        // biome-ignore lint/suspicious/noUnnecessaryConditions: while-true is the canonical pattern for stream readers
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      }

      const headers: Record<string, string> = {};
      if (typeof upstream.headers.forEach === 'function') {
        upstream.headers.forEach((value: string, name: string) => {
          headers[name.toLowerCase()] = value;
        });
      }
      return {
        status: upstream.status,
        headers,
        body: decoded(),
        // B2.1: direct abort path — bypasses generator unwinding, which can
        // stall behind a pending next() on a hung upstream.
        abort: () => controller.abort(),
      };
    },
  };
}
