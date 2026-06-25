import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CacheObservation } from './observability/types.js';

const FLAG = 'PROXITOR_DUMP_BODY';
const DIR_ENV = 'PROXITOR_DUMP_DIR';

export function dumpEnabled(): boolean {
  return process.env[FLAG] === '1';
}

/** Directory for dump files — overridable for tests. */
export function dumpDir(): string {
  return process.env[DIR_ENV] ?? join(homedir(), '.cache', 'proxitor', 'dumps');
}

/** Allow only alnum, dash, underscore in filenames — defend against malformed IDs. */
function safeName(reqId: string): string {
  return reqId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Filename-safe, fixed-width, lexicographically-sortable local timestamp. */
function tsSlug(): string {
  const d = new Date();
  const p = (n: number, l = 2): string => `${n}`.padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

function filePath(reqId: string, model: string | undefined): string {
  const id = safeName(reqId);
  const slug = model && model.length > 0 ? safeName(model) : '';
  const parts = [tsSlug(), slug, id].filter(Boolean);
  return join(dumpDir(), `${parts.join('_')}.json`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export type DumpRequestMeta = {
  forwardBody: ArrayBuffer | undefined;
  method: string;
  model: string | undefined;
  path: string;
  reqId: string;
};

function parseForwardBody(body: ArrayBuffer | undefined): unknown {
  if (!body || body.byteLength === 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

/** `response` is filled later by dumpResponse, once the upstream stream completes.
 * Returns the dump file path (threaded through the request context to the
 * DumpSink) so the response half can locate it without a reqId→path lookup. */
export function dumpRequest(meta: DumpRequestMeta): string | undefined {
  if (!dumpEnabled()) return undefined;
  ensureDir(dumpDir());
  const record = {
    reqId: meta.reqId,
    ts: new Date().toISOString(),
    method: meta.method,
    path: meta.path,
    model: meta.model ?? null,
    request: parseForwardBody(meta.forwardBody),
    response: null,
  };
  const path = filePath(meta.reqId, meta.model);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

export async function dumpResponse(obs: CacheObservation): Promise<void> {
  if (!dumpEnabled()) return;
  const path = obs.dumpPath;
  if (path === undefined) return; // request wasn't dumped (e.g. flag flipped mid-flight)

  try {
    const record = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
    const r = obs.routing;
    // routing is optional. When present its required fields are non-null, so we
    // spread them directly; when absent we serialize explicit nulls so the dump
    // always carries a complete routing block (and stays biome-clean — the
    // non-optional RoutingMetadata fields can't be guarded with `?? null`).
    record.response = {
      status: obs.status,
      label: obs.outcome.label,
      requestType: obs.requestType,
      model: obs.model,
      sessionId: obs.sessionId ?? null,
      toolsCount: obs.toolsCount,
      inputTokens: obs.usage.inputTokens,
      cacheRead: obs.usage.cacheRead,
      cacheCreate: obs.usage.cacheCreate,
      hitPct: obs.outcome.hitPct,
      ...(r
        ? {
            provider: r.provider,
            strategy: r.strategy,
            region: r.region ?? null,
            attempt: r.attempt,
            fallback: r.fallback,
            generationId: r.generationId ?? null,
          }
        : {
            provider: null,
            strategy: null,
            region: null,
            attempt: null,
            fallback: false,
            generationId: null,
          }),
    };
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Best-effort diagnostics — never disrupt the proxy over a dump failure.
  }
}
