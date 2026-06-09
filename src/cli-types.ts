import { extendType, number, oneOf, optional, string, type Type } from 'cmd-ts';
import { tryFindConfigFile } from './config.js';
import type { AuthType } from './config-schema.js';

/**
 * Positional config-path argument. Resolves to the user-supplied path or
 * the result of {@link tryFindConfigFile}. `undefined` when neither yields a file.
 *
 * Use this anywhere a command accepts a config file (or none).
 */
export const ConfigPath: Type<string, string | undefined> = optional(string);

/**
 * Required: port 1-65535. Rejects out-of-range values with a clear message
 * before the handler runs.
 */
export const Port = extendType(number, {
  from: async n => {
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`Port must be an integer in 1-65535 (got ${n})`);
    }
    return n;
  },
});

/**
 * Required: non-empty string.
 */
export const NonEmptyString = extendType(string, {
  from: async s => {
    if (!s.trim()) throw new Error('Value must not be empty');
    return s;
  },
});

/**
 * `bearer` | `oauth`. Rejects anything else at parse time.
 */
export const AuthTypeCli: Type<string, AuthType> = oneOf(['bearer', 'oauth'] as const);

/**
 * OpenRouter API key argument. Resolution chain is handled entirely by cmd-ts:
 *
 *   1. `--openrouter-key <key>` / `-k <key>` (CLI)
 *   2. `OPENROUTER_API_KEY` env var (via `env:` field)
 *   3. `undefined` (handler decides what to do)
 *
 * If the handler later calls `loadConfig`, the file's `openrouterKey` is
 * consulted as a final fallback, mirroring the precedence from
 * `loadConfig` itself.
 */
export const OpenRouterKey: Type<string, string | undefined> = optional(string);

/**
 * Search for a proxitor config file under conventional locations and return its
 * absolute path. Throws if the user passed `--config <path>` and it does not
 * exist; returns `null` if no file is found.
 *
 * Use this in handlers to resolve a config path consistently.
 */
export { tryFindConfigFile };
