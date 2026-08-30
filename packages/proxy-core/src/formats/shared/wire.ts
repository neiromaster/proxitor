import type { CacheControl, NodeExtensions } from '@proxitor/plugin-api';
import type { Json } from './validate.js';

/** Codec-internal wire-shape provenance namespace; the plugin channel is `$proxitor.` (spec §4.3). */
export const WIRE_KEY = '$wire';

/** Plugin extension-key prefix (spec §4.3); the reserved keys themselves live in
 * plugin-api `RESERVED_KEYS`. Encoders strip these from the extension bag so a
 * plugin channel never leaks onto the wire verbatim. */
export const PROXITOR_PREFIX = '$proxitor.';
export type WireMeta = Record<string, unknown>;

export function readWireMeta(extensions?: NodeExtensions): WireMeta {
  const meta = extensions?.[WIRE_KEY];
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? (meta as WireMeta)
    : {};
}

export function toCacheControl(wire: unknown): CacheControl | undefined {
  if (typeof wire !== 'object' || wire === null) return undefined;
  const cc = wire as { type?: unknown; ttl?: unknown };
  if (cc.type !== 'ephemeral') return undefined;
  if (cc.ttl === '5m' || cc.ttl === '1h') return { type: 'ephemeral', ttl: cc.ttl };
  return { type: 'ephemeral' };
}

export function fromCacheControl(cc: CacheControl | undefined): unknown {
  if (cc === undefined) return undefined;
  return cc.ttl === undefined
    ? { type: 'ephemeral' }
    : { type: 'ephemeral', ttl: cc.ttl };
}

/** Copy extension keys onto a wire node, skipping the codec-internal `$wire`
 * namespace (both codecs encode this identically). */
export function passthrough(extensions?: NodeExtensions): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(extensions ?? {})) {
    if (key === WIRE_KEY) continue;
    out[key] = value;
  }
  return out;
}
