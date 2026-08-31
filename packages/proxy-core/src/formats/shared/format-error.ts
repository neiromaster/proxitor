import type { CanonicalError } from '@proxitor/plugin-api';

/** Codec failure or capability gap; the pipeline maps `canonical` to the client's wire-error format (spec §10). */
export class FormatError extends Error {
  readonly canonical: CanonicalError;

  constructor(canonical: CanonicalError) {
    super(canonical.message);
    this.name = 'FormatError';
    this.canonical = canonical;
  }
}

export function invalidRequest(message: string): FormatError {
  return new FormatError({ type: 'invalid_request_error', message, status: 400 });
}

export function parseJsonBody(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw invalidRequest('request body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidRequest('request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
