import { readFile, stat } from 'node:fs/promises';
import type { CredentialResolverPort } from '../application/credentials.js';
import type { CredentialRef } from '../domain/index.js';

export type CredentialAdapter = CredentialResolverPort & {
  /** D16: load-time check — file perms (600) + content; fills the sync cache. */
  preload(refs: readonly CredentialRef[]): Promise<void>;
};

export function createCredentialAdapter(deps?: {
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{ mode: number }>;
}): CredentialAdapter {
  const env = deps?.env ?? process.env;
  const doRead = deps?.readFile ?? (path => readFile(path, 'utf8'));
  const doStat = deps?.stat ?? (path => stat(path));
  let fileCache = new Map<string, string>();

  const resolve = (ref: CredentialRef): string => {
    if (typeof ref === 'string') return ref;
    if ('env' in ref) {
      const value = env[ref.env];
      if (value === undefined || value.length === 0) {
        throw new Error(`credential env "${ref.env}" is not set`);
      }
      return value;
    }
    const cached = fileCache.get(ref.file);
    if (cached === undefined) {
      throw new Error(
        `credential file "${ref.file}" not preloaded (call preload at startup)`,
      );
    }
    return cached;
  };

  const validateEnvRef = (ref: { env: string }): void => {
    const value = env[ref.env];
    if (value === undefined || value.length === 0) {
      throw new Error(`credential env "${ref.env}" is not set`);
    }
  };

  const loadFileRef = async (ref: { file: string }): Promise<string> => {
    const info = await doStat(ref.file);
    if ((info.mode & 0o777) !== 0o600) {
      throw new Error(
        `credential file "${ref.file}" must have mode 600 (got ${(info.mode & 0o777).toString(8)})`,
      );
    }
    const content = (await doRead(ref.file)).trim();
    if (content.length === 0) {
      throw new Error(`credential file "${ref.file}" is empty`);
    }
    return content;
  };

  const preload = async (refs: readonly CredentialRef[]): Promise<void> => {
    // Re-read every file ref into a fresh cache so rotated key files are
    // picked up on reload and stale removed refs are dropped. Swap only on
    // complete success — on failure the previous cache stays intact
    // (keep-last-valid: the still-active config keeps resolving).
    const next = new Map<string, string>();
    for (const ref of refs) {
      if (typeof ref === 'string') continue;
      if ('env' in ref) {
        validateEnvRef(ref);
        continue;
      }
      if ('file' in ref) {
        next.set(ref.file, await loadFileRef(ref));
      }
    }
    fileCache = next;
  };

  return { resolve, preload };
}
