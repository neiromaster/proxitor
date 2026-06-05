import { tryParseBody } from '../utils.js';

export type InjectionParams = {
  providerRouting?: Record<string, unknown>;
  cacheControl?: boolean;
  sessionId?: string;
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
): ArrayBuffer {
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

  if (params.sessionId && !('session_id' in json)) {
    json.session_id = params.sessionId;
  }

  return new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer;
}

export function injectProvider(
  rawBody: ArrayBuffer,
  providerRouting: Record<string, unknown>,
): ArrayBuffer {
  return injectBodyFields(rawBody, { providerRouting });
}
