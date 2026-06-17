import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { readConfigFile } from '../../config.js';
import type { ModelOverride } from '../../config-schema.js';
import { cacheControlCommand } from './cache-control.js';
import {
  formatGlobalCachingSummary,
  formatPerModelCachingSummary,
} from './caching-summary.js';
import { requireConfigPath, setModelOverride } from './config.js';
import { editCacheControl, editNormalizeVolatileSystem, editSessionId } from './edit.js';
import { normalizeVolatileSystemCommand } from './normalize-system.js';
import { sessionRoutingCommand } from './session-routing.js';

/**
 * Global "Caching" screen: shows the three levers' resolved state, then drills
 * into the existing per-lever commands (which persist immediately). Loops until
 * Back/Cancel so several levers can be tuned without leaving the screen.
 */
export async function globalCachingMenu(opts?: { configPath?: string }): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);

  for (;;) {
    const cfg = readConfigFile(configPath);
    clack.note(formatGlobalCachingSummary(cfg), 'Prompt caching');

    const choice = await clack.select<string>({
      message: 'Tune which lever?',
      options: [
        {
          value: 'cacheControl',
          label: 'Activate caching — mode + TTL (cacheControl)',
        },
        { value: 'sessionId', label: 'Pin provider (sessionId)' },
        {
          value: 'normalizeVolatileSystem',
          label: 'Stabilize prefix (normalizeVolatileSystem)',
        },
        { value: 'back', label: '← Back' },
      ],
    });
    if (isCancel(choice) || choice === 'back') return;

    if (choice === 'cacheControl') {
      await cacheControlCommand({ configPath });
    } else if (choice === 'sessionId') {
      await sessionRoutingCommand({ configPath });
    } else if (choice === 'normalizeVolatileSystem') {
      await normalizeVolatileSystemCommand({ configPath });
    }
  }
}

/**
 * Per-model "Caching" screen: shows inherit-aware state, drills into the
 * per-model edit helpers, and persists each changed lever immediately via
 * setModelOverride. Returns the latest override so the edit loop's hints stay
 * in sync (the writes have already happened).
 */
export async function perModelCachingMenu(opts: {
  modelKey: string;
  current: ModelOverride;
  configPath: string;
}): Promise<ModelOverride> {
  let current = opts.current;

  for (;;) {
    const globalCfg = readConfigFile(opts.configPath);
    clack.note(
      formatPerModelCachingSummary(opts.modelKey, current, globalCfg),
      `Caching for "${opts.modelKey}"`,
    );

    const choice = await clack.select<string>({
      message: 'Tune which lever?',
      options: [
        {
          value: 'cacheControl',
          label: 'Activate caching — mode + TTL (cacheControl)',
        },
        { value: 'sessionId', label: 'Pin provider (sessionId)' },
        {
          value: 'normalizeVolatileSystem',
          label: 'Stabilize prefix (normalizeVolatileSystem)',
        },
        { value: 'back', label: '← Back to override edit' },
      ],
    });
    if (isCancel(choice) || choice === 'back') return current;

    const before = current;
    if (choice === 'cacheControl') {
      current = await editCacheControl(current, opts.configPath);
    } else if (choice === 'sessionId') {
      current = await editSessionId(current);
    } else if (choice === 'normalizeVolatileSystem') {
      current = await editNormalizeVolatileSystem(current);
    }

    if (current !== before) {
      setModelOverride(opts.configPath, opts.modelKey, current);
    }
  }
}

/** `proxitor config cache` — CLI entry that wraps the global screen. */
export async function cachingCommand(opts?: { configPath?: string }): Promise<void> {
  clack.intro('Proxitor · Caching');
  await globalCachingMenu(opts);
  clack.outro('Bye!');
}
