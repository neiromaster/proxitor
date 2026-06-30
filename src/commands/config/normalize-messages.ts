import { runBooleanFixCommand } from './boolean-fix.js';
import { askNormalizeMessages } from './prompts.js';

export async function normalizeMessagesCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  return runBooleanFixCommand({
    configPath: opts?.configPath,
    field: 'normalizeMessages',
    message:
      'Lift stray role:"system" out of /v1/messages into top-level system? Fixes 400 rejections from strict Anthropic-format providers (OpenRouter → GLM et al.). Acts on /v1/messages only.',
    ask: askNormalizeMessages,
  });
}
