import { runBooleanFixCommand } from './boolean-fix.js';
import { askNormalizeResponses } from './prompts.js';

export async function normalizeResponsesCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  return runBooleanFixCommand({
    configPath: opts?.configPath,
    field: 'normalizeResponses',
    message:
      'Repair /v1/responses request bodies for OpenRouter (tag input types, lift role:"system" into instructions, synthesize assistant id/status)? Acts on /v1/responses only.',
    ask: askNormalizeResponses,
  });
}
