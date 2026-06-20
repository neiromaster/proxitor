import { isDeepStrictEqual } from 'node:util';
import type { ModelOverride } from '../../config-schema.js';

/** Deep equality for overrides — gates no-op writes. */
export function overridesEqual(a: ModelOverride, b: ModelOverride): boolean {
  return isDeepStrictEqual(a, b);
}
