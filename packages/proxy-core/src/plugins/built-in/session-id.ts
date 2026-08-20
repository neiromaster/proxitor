import type {
  CanonicalContentBlock,
  CanonicalRequest,
  CanonicalSystemBlock,
  ProxyPlugin,
} from '@proxitor/plugin-api';
import { definePlugin } from '@proxitor/plugin-api';
import { z } from 'zod';

/**
 * Sticky routing via `x-session-id` on the outboundHeaders channel (D18,
 * spec §10a). Content-fingerprint derivation (D-M4b-4): sha256 over logical
 * model + joined system texts + first user message content signature. The
 * FIRST user message is immutable in a growing conversation, so the id is
 * stable across turns; signatures exclude cacheControl fields so plugin order
 * cannot drift the fingerprint. Port of legacy src/proxy/utils/session-id.ts.
 */
const sessionIdConfigSchema = z.preprocess(
  val => (val === undefined || val === null ? {} : val),
  z.object({ mode: z.enum(['auto', 'skip']).default('auto') }).strict(),
);

export type SessionIdPluginConfig = z.infer<typeof sessionIdConfigSchema>;
export type SessionIdState = { fallbackId: string } | undefined;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function systemFingerprint(system: readonly CanonicalSystemBlock[]): string {
  return system.map(block => block.text).join('\n\n');
}

/** Order-robust content signature: no cacheControl fields, bounded image cost. */
function contentFingerprint(content: readonly CanonicalContentBlock[]): string {
  return JSON.stringify(
    content.map(block => {
      switch (block.type) {
        case 'text':
          return { t: block.text };
        case 'image':
          return {
            i:
              block.source.kind === 'base64'
                ? block.source.data.length
                : block.source.url,
          };
        case 'tool_use':
          return { u: block.name };
        case 'tool_result':
          return {
            r:
              typeof block.content === 'string'
                ? block.content
                : contentFingerprint(block.content),
          };
        case 'thinking':
          return { h: block.thinking.length };
        default:
          return {};
      }
    }),
  );
}

export async function deriveSessionId(
  req: CanonicalRequest,
  fallback: () => string,
): Promise<string> {
  const system = req.system.length > 0 ? systemFingerprint(req.system) : null;
  const firstUser = req.messages.find(
    message => message.role === 'user' && message.content.length > 0,
  )?.content;
  const user = firstUser === undefined ? null : contentFingerprint(firstUser);
  if (system === null && user === null) return fallback();
  return sha256Hex(`${req.model.logical}
${system}
${user}`);
}

export function createSessionIdPlugin(): ProxyPlugin<SessionIdPluginConfig> {
  let fallbackId: string | undefined;
  return definePlugin(sessionIdConfigSchema, {
    name: 'session-id',
    async onRequest(ctx, req) {
      if (ctx.config.mode === 'skip') return req;
      const fb = fallbackId ?? ctx.random.uuid();
      fallbackId = fb;
      const id = await deriveSessionId(req, () => fb);
      return { ...req, outboundHeaders: { ...req.outboundHeaders, 'x-session-id': id } };
    },
    exportState: () =>
      fallbackId === undefined ? undefined : ({ fallbackId } satisfies SessionIdState),
    restoreState(state) {
      if (
        state !== undefined &&
        state !== null &&
        typeof state === 'object' &&
        'fallbackId' in state
      ) {
        const s = state as SessionIdState;
        if (s !== undefined) {
          fallbackId = s.fallbackId;
        }
      }
    },
  });
}
