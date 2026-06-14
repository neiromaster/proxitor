import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Sandbox XDG config discovery so tests never pick up a developer's real
 * `~/.config/proxitor/config.*`.
 *
 * Any test that calls `loadConfig`/`tryFindConfigFile` without `noConfig` and
 * without an explicit `configPath` — and only isolates the current directory
 * via `chdir(tmpdir())` — would still discover and load the real XDG config,
 * producing machine-specific failures (the same class of bug as PR #49).
 *
 * `getXdgConfigDir()` honors `XDG_CONFIG_HOME` over `homedir()/.config`, so
 * pointing it at an empty temp dir fully redirects discovery away from the
 * user's home. Runs once per test file, so a mutation in one file cannot bleed
 * into the next.
 */
const sandboxDir = join(tmpdir(), 'proxitor-vitest-xdg-sandbox');
mkdirSync(sandboxDir, { recursive: true });
process.env.XDG_CONFIG_HOME = sandboxDir;
