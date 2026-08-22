import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigError } from '../application/config-schema.js';

export type ConfigFilePort = {
  findAndRead(explicitPath?: string): Promise<{ text: string; path: string }>;
  parse(text: string, path: string): unknown;
};

export const HOME_CANDIDATES = [
  'proxitor.config.yaml',
  'proxitor.config.yml',
  'proxitor.config.json',
  '.proxitor.yaml',
  '.proxitor.yml',
  '.proxitor.json',
] as const;
const XDG_CANDIDATES = ['config.yaml', 'config.yml', 'config.json'] as const;

function configDir(env: Record<string, string | undefined>): string {
  const xdg = env.XDG_CONFIG_HOME;
  return xdg !== undefined && xdg.length > 0
    ? resolve(xdg, 'proxitor')
    : join(homedir(), '.config', 'proxitor');
}

/** Default wizard write target: the first XDG candidate (spec §6 XDG search). */
export function defaultWritePath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(configDir(env), 'config.yaml');
}

/** Find the first existing home config that would shadow an XDG config. */
export async function findShadowingHomeConfig(
  existsImpl?: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  const doExists =
    existsImpl ??
    (async (path: string) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    });

  for (const name of HOME_CANDIDATES) {
    const path = join(homedir(), name);
    if (await doExists(path)) {
      return path;
    }
  }
  return undefined;
}

export function createConfigFile(options?: {
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<string>;
}): ConfigFilePort {
  const env = options?.env ?? process.env;
  const doRead = options?.readFile ?? (path => readFile(path, 'utf8'));

  return {
    async findAndRead(explicitPath) {
      if (explicitPath !== undefined) {
        try {
          return { text: await doRead(explicitPath), path: explicitPath };
        } catch (error) {
          throw new ConfigError(`config file not found: ${explicitPath}`, {
            cause: error,
          });
        }
      }
      const candidates = [
        ...HOME_CANDIDATES.map(name => join(homedir(), name)),
        ...XDG_CANDIDATES.map(name => join(configDir(env), name)),
      ];
      for (const path of candidates) {
        try {
          return { text: await doRead(path), path };
        } catch {
          // try next candidate
        }
      }
      throw new ConfigError(`no config found (searched: ${candidates.join(', ')})`);
    },
    parse(text, path) {
      try {
        return path.endsWith('.json') ? (JSON.parse(text) as unknown) : parseYaml(text);
      } catch (error) {
        throw new ConfigError(
          `${path}: parse failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },
  };
}
