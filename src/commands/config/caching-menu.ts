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

/** Persists each changed lever itself; returns the latest override for display sync. */
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

export async function cachingCommand(opts?: { configPath?: string }): Promise<void> {
  clack.intro('Proxitor · Caching');
  await globalCachingMenu(opts);
  clack.outro('Bye!');
}
