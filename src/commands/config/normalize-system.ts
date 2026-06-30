import { runBooleanFixCommand } from './boolean-fix.js';
import { askNormalizeVolatileSystem } from './prompts.js';

export async function normalizeVolatileSystemCommand(opts?: {
  configPath?: string;
}): Promise<void> {
  return runBooleanFixCommand({
    configPath: opts?.configPath,
    field: 'normalizeVolatileSystem',
    message:
      "Normalize Claude Code's volatile cch and cc_version hashes in the system prompt? Stabilizes the prefix cache for non-Anthropic providers (qwen/glm/etc.).",
    ask: askNormalizeVolatileSystem,
  });
}
