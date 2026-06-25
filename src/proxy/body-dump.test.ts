import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dumpDir, dumpEnabled, dumpRequest, dumpResponse } from './body-dump.js';
import type { CacheObservation } from './observability/types.js';

const ENV = { body: 'PROXITOR_DUMP_BODY', dir: 'PROXITOR_DUMP_DIR' };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'proxitor-dump-'));
  process.env[ENV.body] = '1';
  process.env[ENV.dir] = dir;
});

afterEach(() => {
  delete process.env[ENV.body];
  delete process.env[ENV.dir];
  rmSync(dir, { recursive: true, force: true });
});

/** Read a dump by reqId regardless of the timestamp/model prefix in its filename. */
function read(reqId: string): Record<string, unknown> {
  const files = readdirSync(dir);
  const match = files.find(f => f.endsWith(`${reqId}.json`));
  if (!match) throw new Error(`no dump file for reqId ${reqId}`);
  return JSON.parse(readFileSync(join(dir, match), 'utf-8'));
}

describe('dumpEnabled', () => {
  it('returns true when PROXITOR_DUMP_BODY=1', () => {
    // Arrange — env set in beforeEach
    // Act & Assert
    expect(dumpEnabled()).toBe(true);
  });

  it('returns false when unset', () => {
    // Arrange
    delete process.env[ENV.body];
    // Act & Assert
    expect(dumpEnabled()).toBe(false);
  });
});

describe('dumpDir', () => {
  it('honours PROXITOR_DUMP_DIR override', () => {
    // Arrange — dir set in beforeEach
    // Act & Assert
    expect(dumpDir()).toBe(dir);
  });
});

describe('dumpRequest — filename', () => {
  it('prefixes the filename with a sortable timestamp and sanitized model slug', () => {
    // Arrange
    const body = new TextEncoder().encode('{}').buffer;

    // Act
    dumpRequest({
      reqId: 'abc12345',
      method: 'POST',
      path: '/v1/messages',
      model: 'minimax/ai/MiniMax-M3',
      forwardBody: body,
    });

    // Assert — YYYYMMDD-HHMMSS-mmm_minimax_ai_MiniMax-M3-abc12345.json
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}-\d{6}-\d{3}_minimax_ai_MiniMax-M3_abc12345\.json$/);
  });

  it('omits the slug when model is absent', () => {
    // Arrange & Act
    dumpRequest({
      reqId: 'nomodel',
      method: 'POST',
      path: '/v1/messages',
      model: undefined,
      forwardBody: undefined,
    });

    // Assert — timestamp prefix still present
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}-\d{6}-\d{3}_nomodel\.json$/);
  });

  it('sorts lexicographically by timestamp across requests', () => {
    // Arrange & Act — two requests back to back (timestamps strictly increase)
    dumpRequest({
      reqId: 'first1',
      method: 'POST',
      path: '/v1/messages',
      model: 'm',
      forwardBody: undefined,
    });
    dumpRequest({
      reqId: 'second2',
      method: 'POST',
      path: '/v1/messages',
      model: 'm',
      forwardBody: undefined,
    });

    // Assert — filenames share the same model slug but differ in timestamp+reqId
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/first1\.json$/);
    expect(files[1]).toMatch(/second2\.json$/);
  });
});

describe('dumpRequest — contents', () => {
  it('writes a per-request file with the parsed forwarded body', () => {
    // Arrange
    const body = new TextEncoder().encode(
      JSON.stringify({ model: 'minimax/m3', system: 'hi', messages: [] }),
    ).buffer;
    const meta = {
      reqId: 'abc12345',
      method: 'POST',
      path: '/v1/messages',
      model: 'minimax/m3',
      forwardBody: body,
    };

    // Act
    dumpRequest(meta);

    // Assert
    const rec = read('abc12345');
    expect(rec.reqId).toBe('abc12345');
    expect(rec.method).toBe('POST');
    expect(rec.path).toBe('/v1/messages');
    expect(rec.model).toBe('minimax/m3');
    expect(rec.request).toEqual({ model: 'minimax/m3', system: 'hi', messages: [] });
    expect(rec.response).toBeNull();
  });

  it('nulls model and request when they are absent', () => {
    // Arrange
    const meta = {
      reqId: 'm1',
      method: 'POST',
      path: '/v1/messages',
      model: undefined,
      forwardBody: undefined,
    };

    // Act
    dumpRequest(meta);

    // Assert
    const rec = read('m1');
    expect(rec.model).toBeNull();
    expect(rec.request).toBeNull();
  });

  it('stores null request for an unparseable body', () => {
    // Arrange
    const body = new TextEncoder().encode('not-json').buffer;

    // Act
    dumpRequest({
      reqId: 'm2',
      method: 'POST',
      path: '/v1/messages',
      model: 'x',
      forwardBody: body,
    });

    // Assert
    expect(read('m2').request).toBeNull();
  });

  it('is a no-op when the flag is off', () => {
    // Arrange
    delete process.env[ENV.body];

    // Act
    dumpRequest({
      reqId: 'm3',
      method: 'POST',
      path: '/v1/messages',
      model: 'x',
      forwardBody: undefined,
    });

    // Assert
    expect(readdirSync(dir)).toHaveLength(0);
  });
});

describe('dumpResponse', () => {
  // Local builder mirroring the CacheObservation shape consumed by the new signature.
  const obs = (over: Partial<CacheObservation> = {}): CacheObservation => ({
    reqId: 'r1',
    status: 200,
    model: 'x',
    requestType: 'main',
    toolsCount: 0,
    usage: { present: true, inputTokens: 10000, cacheRead: 9500, cacheCreate: 500 },
    outcome: { label: 'HIT', type: 'main', hitPct: 95 },
    ...over,
  });

  it('appends enriched response usage and preserves the classified hit percentage', () => {
    // Arrange
    dumpRequest({
      reqId: 'r1',
      method: 'POST',
      path: '/v1/messages',
      model: 'x',
      forwardBody: undefined,
    });

    // Act — hitPct comes from the classifier (1 decimal), not recomputed here.
    dumpResponse(
      obs({
        usage: { present: true, inputTokens: 10000, cacheRead: 9500, cacheCreate: 500 },
        outcome: { label: 'HIT', type: 'main', hitPct: 95 },
        routing: {
          provider: 'Novita',
          strategy: 'direct',
          attempt: 1,
          fallback: false,
          generationId: 'gen-1',
        },
      }),
    );

    // Assert — enriched record carries the classified label, routing and tokens.
    expect(read('r1').response).toMatchObject({
      status: 200,
      label: 'HIT',
      provider: 'Novita',
      generationId: 'gen-1',
      cacheRead: 9500,
      cacheCreate: 500,
      inputTokens: 10000,
      hitPct: 95,
    });
  });

  it('records zero hitPct when there are no input tokens', () => {
    // Arrange
    dumpRequest({
      reqId: 'r2',
      method: 'POST',
      path: '/v1/messages',
      model: 'x',
      forwardBody: undefined,
    });

    // Act
    dumpResponse(
      obs({
        reqId: 'r2',
        usage: { present: true, inputTokens: 0, cacheRead: 0, cacheCreate: 0 },
        outcome: { label: 'MISS', type: 'main', hitPct: 0 },
      }),
    );

    // Assert
    const response = read('r2').response as { hitPct: number };
    expect(response.hitPct).toBe(0);
  });

  it('records status and null routing when usage is absent (NOUSAGE)', () => {
    // Arrange
    dumpRequest({
      reqId: 'r3',
      method: 'POST',
      path: '/v1/messages',
      model: 'x',
      forwardBody: undefined,
    });

    // Act — no usage parsed upstream; outcome collapses to NOUSAGE with zeroed tokens.
    dumpResponse(
      obs({
        reqId: 'r3',
        status: 504,
        usage: { present: false, inputTokens: 0, cacheRead: 0, cacheCreate: 0 },
        outcome: { label: 'NOUSAGE', type: 'main', hitPct: 0 },
      }),
    );

    // Assert
    expect(read('r3').response).toMatchObject({
      status: 504,
      label: 'NOUSAGE',
      cacheRead: 0,
      cacheCreate: 0,
      inputTokens: 0,
      hitPct: 0,
      provider: null,
    });
  });

  it('is a no-op when no matching request file exists', () => {
    // Arrange — no prior dumpRequest for "ghost"

    // Act
    dumpResponse(obs({ reqId: 'ghost' }));

    // Assert
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
