import * as clack from '@clack/prompts';
import { fixBaseline, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';
import { askNormalizeResponses } from './prompts.js';

export async function normalizeResponsesCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  const configPath = requireConfigPath(opts?.configPath);
  const cfg = readConfigFileRaw(configPath);
  const raw = cfg.normalizeResponses;
  const base = fixBaseline(cfg.recommended ?? false);
  const effective = raw ?? (base.normalizeResponses as boolean);

  clack.log.info(
    `Current: normalizeResponses = ${raw === undefined ? `(default -> ${effective ? 'on' : 'off'})` : effective}`,
  );

  const choice = await askNormalizeResponses(
    'Repair /v1/responses request bodies for OpenRouter (tag input types, lift role:"system" into instructions, synthesize assistant id/status)? Acts on /v1/responses only.',
    raw,
    {
      removable: true,
      resetHint: `remove (default: ${base.normalizeResponses ? 'on' : 'off'})`,
    },
  );
  if (typeof choice === 'symbol') return; // cancelled

  const fields: Record<string, unknown> = {};
  fields.normalizeResponses = choice === 'reset' ? undefined : choice;
  setGlobalConfigFields(configPath, fields);

  const label =
    choice === 'reset' ? `(default: ${base.normalizeResponses ? 'on' : 'off'})` : choice;
  clack.log.success(`normalizeResponses set to ${label}`);
}
