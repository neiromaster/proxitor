import * as clack from '@clack/prompts';
import type { ModelOverride } from '../../config-schema.js';
import { getModelOverrides, requireConfigPath } from './config.js';

function formatOverrideSummary(override: ModelOverride): string {
  const parts: string[] = [];

  if (override.provider) {
    for (const [field, value] of Object.entries(override.provider)) {
      if (value !== undefined) parts.push(`${field}: ${JSON.stringify(value)}`);
    }
  }

  if (override.headers) {
    for (const [name, value] of Object.entries(override.headers)) {
      parts.push(`header ${name}: ${value}`);
    }
  }

  if (override.sessionId) parts.push(`session: ${override.sessionId}`);
  if (override.cacheControl) parts.push(`cache: ${override.cacheControl}`);
  if (override.cacheControlTtl) parts.push(`ttl: ${override.cacheControlTtl}`);

  return parts.join(', ') || '(empty)';
}

type ListArgs = { json?: boolean | undefined; configPath?: string | undefined };

export async function listOverridesCommand(args: ListArgs = {}): Promise<void> {
  const configPath = requireConfigPath(args.configPath);
  const overrides = getModelOverrides(configPath);
  const keys = Object.keys(overrides);

  if (keys.length === 0) {
    if (args.json) {
      process.stdout.write('[]\n');
      return;
    }
    clack.log.info('No model overrides configured.');
    return;
  }

  if (args.json) {
    const payload = {
      configPath,
      count: keys.length,
      overrides: keys.map(k => ({ model: k, ...overrides[k] })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  clack.log.success(`${keys.length} override(s) in ${configPath}`);

  for (const key of keys) {
    const override = overrides[key];
    if (!override) continue;
    clack.log.info(`  ${key} — ${formatOverrideSummary(override)}`);
  }
}
