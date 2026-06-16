import { createMiddleware } from 'hono/factory';
import type { ParsedRequestBody, ProxyEnv } from '../context.js';

/** Normalize Claude Code's per-request `cch=…` hash in system[0] to a constant; it drifts every turn and breaks prefix-cache for non-Anthropic providers. */
const CCH_PATTERN = /cch=[0-9a-f]+/g;
const CCH_REPLACEMENT = 'cch=00000';

type TextBlock = Record<string, unknown> & { text?: unknown };

function normalizeText(text: string): string {
  return text.replace(CCH_PATTERN, CCH_REPLACEMENT);
}

function textOf(block: unknown): string | undefined {
  if (
    block !== null &&
    typeof block === 'object' &&
    typeof (block as TextBlock).text === 'string'
  ) {
    return (block as TextBlock).text as string;
  }
  return undefined;
}

export function normalizeVolatileSystemBlocks(system: unknown): {
  changed: boolean;
  value: unknown;
} {
  if (typeof system === 'string') {
    const value = normalizeText(system);
    return { changed: value !== system, value };
  }

  if (!Array.isArray(system)) {
    return { changed: false, value: system };
  }

  // Lazy: find the first changed block without allocating a new array.
  const firstChanged = findFirstChangedTextBlock(system);
  if (firstChanged === -1) return { changed: false, value: system };

  // Copy once, then normalize every text block from the first change onward.
  const value = [...system];
  for (let i = firstChanged; i < value.length; i++) {
    const text = textOf(value[i]);
    if (text !== undefined) (value[i] as TextBlock).text = normalizeText(text);
  }
  return { changed: true, value };
}

function findFirstChangedTextBlock(system: unknown[]): number {
  for (let i = 0; i < system.length; i++) {
    const text = textOf(system[i]);
    if (text !== undefined && normalizeText(text) !== text) return i;
  }
  return -1;
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
