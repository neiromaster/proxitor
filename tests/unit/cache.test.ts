/**
 * Coverage for src/openrouter/cache.ts: readCache / writeCache.
 *
 * cache.ts resolves CACHE_DIR = join(homedir(), '.cache', 'proxitor') at module
 * load. We point homedir() at a temp dir (set before the dynamic import) so the
 * real fs I/O stays isolated from the user's machine.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTempDir, removeTempDir } from '../helpers.js';

// hoisted so the os mock factory can read a live value
const { cacheDirRef } = vi.hoisted(() => ({ cacheDirRef: { value: '' } }));
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => cacheDirRef.value };
});

// Set BEFORE the import: cache.ts evaluates CACHE_DIR at module load.
cacheDirRef.value = createTempDir();
const cacheDir = join(cacheDirRef.value, '.cache', 'proxitor');
const { readCache, writeCache } = await import('../../src/openrouter/cache.js');

afterAll(() => removeTempDir(cacheDirRef.value));

describe('readCache', () => {
  it('returns null when the cache file does not exist (miss)', () => {
    expect(readCache('miss', 1000)).toBeNull();
  });

  it('returns the cached data when fresh (hit)', () => {
    writeCache('hit', { a: 1, nested: { b: 2 } });
    // writeCache must create the cache dir (mkdir recursive) as a side-effect.
    expect(existsSync(cacheDir)).toBe(true);
    expect(readCache('hit', 60_000)).toEqual({ a: 1, nested: { b: 2 } });
  });

  it('returns null when the entry is older than the ttl (expired)', () => {
    writeFileSync(
      join(cacheDir, 'expired.json'),
      JSON.stringify({ data: 'stale', fetchedAt: 1 }),
    );
    expect(readCache('expired', 1000)).toBeNull();
  });

  it('returns null when the cache file is corrupt JSON', () => {
    writeFileSync(join(cacheDir, 'corrupt.json'), '{not valid json');
    expect(readCache('corrupt', 60_000)).toBeNull();
  });
});
