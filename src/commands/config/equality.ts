import { isDeepStrictEqual } from 'node:util';
import type { ModelOverride } from '../../config-schema.js';

/**
 * Structural equality for two model overrides.
 * Covers nested `provider` and `headers`; used to skip no-op writes
 * (instant-save still fires on a real change).
 */
export function overridesEqual(a: ModelOverride, b: ModelOverride): boolean {
  return isDeepStrictEqual(a, b);
}
