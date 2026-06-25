import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** `response` is filled later by dumpResponse, once the upstream stream completes. */
export function dumpRequest(meta: DumpRequestMeta): void {
  if (!dumpEnabled()) return;
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
  writeFileSync(filePath(meta.reqId, meta.model), `${JSON.stringify(record, null, 2)}\n`);
}

export function dumpResponse(obs: CacheObservation): void {
  if (!dumpEnabled()) return;
  const dir = dumpDir();
  if (!existsSync(dir)) return;

  // Locate the request dump by reqId — the timestamp/model prefix is unknown here.
  const name = readdirSync(dir).find(f => f.endsWith(`${obs.reqId}.json`));
  if (!name) return; // request wasn't dumped (e.g. flag flipped mid-flight)
  const path = join(dir, name);

  try {
    const record = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
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
      provider: obs.routing?.provider ?? null,
      strategy: obs.routing?.strategy ?? null,
      region: obs.routing?.region ?? null,
      attempt: obs.routing?.attempt ?? null,
      fallback: obs.routing?.fallback ?? false,
      generationId: obs.routing?.generationId ?? null,
    };
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Best-effort diagnostics — never disrupt the proxy over a dump failure.
  }
}
