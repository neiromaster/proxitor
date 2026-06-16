import { createMiddleware } from 'hono/factory';
import type { ParsedRequestBody, ProxyEnv } from '../context.js';

/** Normalize Claude Code's per-request `cch=…` hash in system[0] to a constant; it drifts every turn and breaks prefix-cache for non-Anthropic providers. */
const CCH_PATTERN = /cch=[0-9a-f]+/g;
const CCH_REPLACEMENT = 'cch=00000';

function normalizeText(text: string): string {
  return text.replace(CCH_PATTERN, CCH_REPLACEMENT);
}

/** Returns the normalized system plus whether any bytes changed. */
export function normalizeVolatileSystemBlocks(system: unknown): {
  changed: boolean;
  value: unknown;
} {
  if (typeof system === 'string') {
    const value = normalizeText(system);
    return { changed: value !== system, value };
  }

  if (Array.isArray(system)) {
    let changed = false;
    let firstChangedIdx = -1;

    // Phase 1: Find the first change without allocating a new array
    for (let i = 0; i < system.length; i++) {
      const block = system[i];
      if (
        block !== null &&
        typeof block === 'object' &&
        typeof (block as Record<string, unknown>).text === 'string'
      ) {
        const original = (block as Record<string, unknown>).text as string;
        const normalized = normalizeText(original);
        if (normalized !== original) {
          changed = true;
          firstChangedIdx = i;
          break;
        }
      }
    }

    // Phase 2: If nothing changed, return the original reference (strict equality preserved)
    if (!changed) {
      return { changed: false, value: system };
    }

    // Phase 3: Only allocate a new array if a change was actually detected
    const value = [...system];
    for (let i = firstChangedIdx; i < value.length; i++) {
      const block = value[i];
      if (
        block !== null &&
        typeof block === 'object' &&
        typeof (block as Record<string, unknown>).text === 'string'
      ) {
        (value[i] as Record<string, unknown>).text = normalizeText(
          (block as Record<string, unknown>).text as string,
        );
      }
    }
    return { changed: true, value };
  }

  return { changed: false, value: system };
}

export const normalizeVolatileSystemMiddleware = createMiddleware<ProxyEnv>(
  async (c, next) => {
    const parsedBody: ParsedRequestBody | undefined = c.var.parsedBody;
    if (!parsedBody || !c.var.resolvedConfig.normalizeVolatileSystem) {
      await next();
      return;
    }

    const { changed, value } = normalizeVolatileSystemBlocks(parsedBody.system);
    if (changed) {
      parsedBody.system = value;
      c.set('bodyMutated', true);
    }

    await next();
  },
);
