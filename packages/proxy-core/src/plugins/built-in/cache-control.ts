import type {
  CacheControl,
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalSystemBlock,
  CanonicalTool,
  ProxyPlugin,
} from '@proxitor/plugin-api';
import { definePlugin } from '@proxitor/plugin-api';
import { z } from 'zod';

/**
 * Cache breakpoint policy on the typed IR (spec §4.1; D-M4b-1/2/3).
 * Rewrite normalizes existing breakpoints toward the configured TTL; inject
 * marks the deepest stable prefix node (last system block → last block of the
 * last content-bearing message → last tool).
 */
const cacheControlConfigSchema = z.preprocess(
  val => (val === undefined || val === null ? {} : val),
  z
    .object({
      cacheControl: z.enum(['auto', 'always', 'skip']).default('auto'),
      ttl: z.enum(['5m', '1h', 'omit']).optional(),
      rewriteBlockTtl: z.enum(['auto', 'skip']).default('auto'),
    })
    .strict(),
);

export type CacheControlPluginConfig = z.infer<typeof cacheControlConfigSchema>;

/** Every IR node shape that can carry a cache breakpoint (spec §4.1). */
type Markable = CanonicalSystemBlock | CanonicalContentBlock | CanonicalTool;

/** The mark the plugin stamps: explicit window, or provider default for 'omit'/unset. */
function appliedCacheControl(ttl: '5m' | '1h' | 'omit' | undefined): CacheControl {
  if (ttl === '5m' || ttl === '1h') return { type: 'ephemeral', ttl };
  return { type: 'ephemeral' };
}

/** True when the block, or any block nested in tool_result content, is marked. */
function blockHasBreakpoint(block: CanonicalContentBlock): boolean {
  if (block.cacheControl !== undefined) return true;
  return (
    block.type === 'tool_result' &&
    Array.isArray(block.content) &&
    block.content.some(blockHasBreakpoint)
  );
}

function requestHasBreakpoint(req: CanonicalRequest): boolean {
  return (
    req.system.some(block => block.cacheControl !== undefined) ||
    (req.tools ?? []).some(tool => tool.cacheControl !== undefined) ||
    req.messages.some(message => message.content.some(blockHasBreakpoint))
  );
}

/** Normalize existing marks toward `ttl` in a flat markable list (system, tools). */
function rewriteMarkables<T extends Markable>(
  items: readonly T[],
  ttl: '5m' | '1h' | 'omit',
): readonly T[] {
  let changed = false;
  const next = items.map(item => {
    if (item.cacheControl === undefined) return item;
    const cc = appliedCacheControl(ttl);
    if (item.cacheControl.ttl === cc.ttl) return item;
    changed = true;
    return { ...item, cacheControl: cc };
  });
  return changed ? next : items;
}

/** Normalize existing marks in content blocks, descending into tool_result content. */
function rewriteContentBlocks(
  blocks: readonly CanonicalContentBlock[],
  ttl: '5m' | '1h' | 'omit',
): readonly CanonicalContentBlock[] {
  let changed = false;
  const next = blocks.map(block => {
    let current: CanonicalContentBlock = block;
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      const nested = rewriteContentBlocks(block.content, ttl);
      if (nested !== block.content)
        current = { ...block, content: nested as typeof block.content };
    }
    if (current.cacheControl !== undefined) {
      const cc = appliedCacheControl(ttl);
      if (current.cacheControl.ttl !== cc.ttl) current = { ...current, cacheControl: cc };
    }
    if (current !== block) changed = true;
    return current;
  });
  return changed ? next : blocks;
}

function rewriteMessages(
  messages: readonly CanonicalMessage[],
  ttl: '5m' | '1h' | 'omit',
): readonly CanonicalMessage[] {
  let changed = false;
  const next = messages.map(message => {
    const content = rewriteContentBlocks(message.content, ttl);
    if (content === message.content) return message;
    changed = true;
    return { ...message, content: content as CanonicalMessage['content'] };
  });
  return changed ? next : messages;
}

/** Copy `arr` with its last element marked; undefined when empty or already marked. */
function markLast<T extends Markable>(
  arr: readonly T[],
  cc: CacheControl,
): readonly T[] | undefined {
  const index = arr.length - 1;
  const last = arr[index];
  if (last === undefined || last.cacheControl !== undefined) return undefined;
  const next = arr.slice();
  next[index] = { ...last, cacheControl: cc };
  return next;
}

type MessageInject =
  | { kind: 'marked'; messages: readonly CanonicalMessage[] }
  | { kind: 'occupied' }
  | { kind: 'empty' };

/** Mark the last block of the last content-bearing message. */
function injectIntoMessages(
  messages: readonly CanonicalMessage[],
  cc: CacheControl,
): MessageInject {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined || message.content.length === 0) continue;
    const marked = markLast(message.content, cc);
    if (marked === undefined) return { kind: 'occupied' };
    const next = messages.slice();
    next[i] = { ...message, content: marked as typeof message.content };
    return { kind: 'marked', messages: next };
  }
  return { kind: 'empty' };
}

type InjectionResult = {
  system: readonly CanonicalSystemBlock[];
  tools: readonly CanonicalTool[] | undefined;
  messages: readonly CanonicalMessage[];
};

/** Inject cache control mark into the appropriate target node. */
function performInjection(
  system: readonly CanonicalSystemBlock[],
  tools: readonly CanonicalTool[] | undefined,
  messages: readonly CanonicalMessage[],
  cc: CacheControl,
): InjectionResult {
  if (system.length > 0) {
    const marked = markLast(system, cc);
    if (marked !== undefined) return { system: marked, tools, messages };
    return { system, tools, messages };
  }

  const target = injectIntoMessages(messages, cc);
  if (target.kind === 'marked') {
    return { system, tools, messages: target.messages };
  }
  if (target.kind === 'empty' && tools !== undefined && tools.length > 0) {
    const markedTools = markLast(tools, cc);
    if (markedTools !== undefined) return { system, tools: markedTools, messages };
  }

  return { system, tools, messages };
}

export function createCacheControlPlugin(): ProxyPlugin<CacheControlPluginConfig> {
  return definePlugin(cacheControlConfigSchema, {
    name: 'cache-control',
    onRequest(ctx, req) {
      const { cacheControl, ttl, rewriteBlockTtl } = ctx.config;

      // Phase 1: Rewrite existing marks toward configured TTL
      let { system, tools, messages } = req;
      if (ttl !== undefined && rewriteBlockTtl !== 'skip') {
        system = rewriteMarkables(req.system, ttl) as typeof req.system;
        if (req.tools !== undefined)
          tools = rewriteMarkables(req.tools, ttl) as typeof req.tools;
        messages = rewriteMessages(req.messages, ttl) as typeof req.messages;
      }

      // Phase 2: Inject new mark if needed
      if (
        cacheControl !== 'skip' &&
        (cacheControl === 'always' || requestHasBreakpoint(req))
      ) {
        const cc = appliedCacheControl(ttl);
        const injected = performInjection(system, tools, messages, cc);
        system = injected.system as typeof req.system;
        tools = injected.tools as typeof req.tools;
        messages = injected.messages as typeof req.messages;
      }

      // Phase 3: Return early if unchanged
      if (system === req.system && tools === req.tools && messages === req.messages)
        return req;
      return { ...req, system, tools, messages };
    },
  });
}
