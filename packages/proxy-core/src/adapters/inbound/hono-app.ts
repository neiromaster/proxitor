import { ENDPOINT_PATHS } from '@proxitor/plugin-api';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type {
  PipelineRequest,
  PipelineResponse,
  ProxyPipeline,
} from '../../application/proxy-pipeline.js';

const CHAT_PATHS: ReadonlySet<string> = new Set([
  ENDPOINT_PATHS['anthropic-messages'],
  ENDPOINT_PATHS['openai-chat'],
]);

/** Openai wire-error shape for pre-pipeline failures (D5: format unknowable before decode). */
function openaiError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(
    { error: { message, type: 'invalid_request_error' } },
    { status, headers: { 'content-type': 'application/json', ...extraHeaders } },
  );
}

/** D-M5a-1: HTTP method semantics live in the adapter, not the pipeline. */
export function createProxyApp(deps: {
  pipeline: ProxyPipeline;
  bodyLimitBytes: number;
}): Hono {
  const app = new Hono();

  app.use(
    '*',
    bodyLimit({
      maxSize: deps.bodyLimitBytes,
      onError: () => {
        const res = openaiError(
          413,
          `request body exceeds limit (${deps.bodyLimitBytes} bytes)`,
        );
        throw new HTTPException(413, { res });
      },
    }),
  );

  app.all('/v1/*', async c => {
    const path = c.req.path;
    const method = c.req.method;

    if (CHAT_PATHS.has(path) && method !== 'POST') {
      return openaiError(405, `${path} supports POST only`, { allow: 'POST' });
    }
    if (path === '/v1/models' && method !== 'GET') {
      return openaiError(405, `${path} supports GET only`, { allow: 'GET' });
    }
    if (method !== 'POST' && method !== 'GET') {
      return openaiError(404, `unknown path '${path}'`);
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of c.req.raw.headers.entries()) {
      headers[name.toLowerCase()] = value;
    }
    const request: PipelineRequest = {
      path,
      method: method === 'GET' ? 'GET' : 'POST',
      headers,
      body: method === 'GET' ? '' : await c.req.text(),
    };
    const response = await deps.pipeline.handle(request);
    return toResponse(response);
  });

  app.notFound(c => openaiError(404, `unknown path '${c.req.path}'`));
  return app;
}

/** Task 5: buffered mapping (streaming arrives in Task 6). */
async function toResponse(pr: PipelineResponse): Promise<Response> {
  let text = '';
  for await (const chunk of pr.body) {
    text += chunk;
  }
  return new Response(text, { status: pr.status, headers: { ...pr.headers } });
}
