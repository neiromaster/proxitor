import { tryParseBody } from '../utils.js';

/** Extract the model name from a raw request body. Returns undefined if not parseable or absent. */
export function extractModel(rawBody: ArrayBuffer): string | undefined {
  const json = tryParseBody(rawBody);
  return typeof json?.model === 'string' ? json.model : undefined;
}

/** Inject provider routing into request body, always overwriting existing value */
export function injectProvider(
  rawBody: ArrayBuffer,
  providerRouting: Record<string, unknown>,
): ArrayBuffer {
  if (rawBody.byteLength === 0) {
    throw new Error('Request body is empty; cannot inject provider');
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
  } catch (parseError) {
    throw new Error('Request body is not valid JSON; cannot inject provider', {
      cause: parseError,
    });
  }

  const modified = { ...json, provider: providerRouting };
  return new TextEncoder().encode(JSON.stringify(modified)).buffer as ArrayBuffer;
}
