import { tryParseBody } from '../utils.js';

export type InjectionParams = {
  providerRouting?: Record<string, unknown>;
  cacheControl?: boolean;
  sessionId?: string;
};

export type InjectionResult = {
  body: ArrayBuffer;
  /** The session_id that ended up in the body (injected or existing). Undefined if none. */
  effectiveSessionId?: string;
};

export function isAnthropicModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return (
    lower.startsWith('anthropic/claude') ||
    lower.startsWith('claude-') ||
    lower.includes('claude')
  );
}

export function extractModel(rawBody: ArrayBuffer): string | undefined {
  const json = tryParseBody(rawBody);
  return typeof json?.model === 'string' ? json.model : undefined;
}

export function injectBodyFields(
  rawBody: ArrayBuffer,
  params: InjectionParams,
): InjectionResult {
  if (rawBody.byteLength === 0) {
    throw new Error('Request body is empty; cannot inject');
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
  } catch (parseError) {
    throw new Error('Request body is not valid JSON; cannot inject', {
      cause: parseError,
    });
  }

  if (params.providerRouting !== undefined) {
    json.provider = params.providerRouting;
  }

  if (params.cacheControl && !('cache_control' in json)) {
    json.cache_control = { type: 'ephemeral' };
  }

  let effectiveSessionId: string | undefined;
  if (params.sessionId) {
    if ('session_id' in json) {
      // Body already has session_id — use the existing value for header consistency
      effectiveSessionId = String(json.session_id);
    } else {
      json.session_id = params.sessionId;
      effectiveSessionId = params.sessionId;
    }
  }

  return {
    body: new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer,
    effectiveSessionId,
  };
}

export function injectProvider(
  rawBody: ArrayBuffer,
  providerRouting: Record<string, unknown>,
): ArrayBuffer {
  return injectBodyFields(rawBody, { providerRouting }).body;
}
