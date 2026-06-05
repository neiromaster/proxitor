import type { AuthType } from './config-schema.js';

/** Format an API key with the appropriate auth prefix based on authType. Defaults to Bearer. */
export function formatAuthHeader(key: string, authType?: AuthType): string {
  return `${authType === 'oauth' ? 'OAuth' : 'Bearer'} ${key}`;
}

/** Normalize a single string or array of strings to an array. Returns undefined for empty arrays. */
export function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const arr = Array.isArray(value) ? [...value] : [value];
  return arr.length > 0 ? arr : undefined;
}

/** Try to parse an ArrayBuffer as JSON. Returns undefined on failure or empty body. */
export function tryParseBody(raw: ArrayBuffer): Record<string, unknown> | undefined {
  if (raw.byteLength === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
