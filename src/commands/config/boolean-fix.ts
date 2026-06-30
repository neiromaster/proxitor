import * as clack from '@clack/prompts';
import { fixBaseline, readConfigFileRaw } from '../../config.js';
import { requireConfigPath, setGlobalConfigFields } from './config.js';

/** The boolean (on/off) fix toggles that share an identical command body. */
type BooleanFixField =
  | 'normalizeMessages'
  | 'normalizeResponses'
  | 'normalizeVolatileSystem';

type AskBooleanFix = (
  message: string,
  current: boolean | undefined,
  opts?: { removable?: boolean; resetHint?: string },
) => Promise<boolean | 'reset' | symbol>;

const onOff = (value: boolean): 'on' | 'off' => (value ? 'on' : 'off');

/**
 * Shared body for the on/off fix toggles (normalize-messages/responses/system).
 * Shows the effective value (explicit override, else the `recommended` preset
 * default), asks via the supplied prompt, and writes the choice back. `reset`
 * removes the key so it inherits the preset again.
 */
export async function runBooleanFixCommand(params: {
  configPath?: string;
  field: BooleanFixField;
  message: string;
  ask: AskBooleanFix;
}): Promise<void> {
  const { configPath, field, message, ask } = params;
  const path = requireConfigPath(configPath);
  const cfg = readConfigFileRaw(path);
  const raw = cfg[field];
  const presetDefault = fixBaseline(cfg.recommended)[field];
  const effective = raw ?? presetDefault;

  clack.log.info(
    `Current: ${field} = ${raw === undefined ? `(default -> ${onOff(effective)})` : effective}`,
  );

  const choice = await ask(message, raw, {
    removable: true,
    resetHint: `remove (default: ${onOff(presetDefault)})`,
  });
  if (typeof choice === 'symbol') return; // cancelled

  const fields: Record<string, unknown> = {};
  fields[field] = choice === 'reset' ? undefined : choice;
  setGlobalConfigFields(path, fields);

  const label = choice === 'reset' ? `(default: ${onOff(presetDefault)})` : choice;
  clack.log.success(`${field} set to ${label}`);
}
