import { readConfigFile } from '../../config.js';
import type { ModelOverride, TriState } from '../../config-schema.js';
import {
  applyField,
  collectCacheTriState,
  collectNormalizeResponsesTriState,
  collectNormalizeVolatileSystem,
  collectSessionTriState,
} from './tri-state.js';

function readGlobalTtl(
  configPath: string | undefined,
): '5m' | '1h' | 'omit' | 'skip' | undefined {
  if (!configPath) return undefined;
  try {
    return readConfigFile(configPath).cacheControlTtl as
      | '5m'
      | '1h'
      | 'omit'
      | 'skip'
      | undefined;
  } catch {
    return undefined;
  }
}

export async function editSessionId(current: ModelOverride): Promise<ModelOverride> {
  const result = await collectSessionTriState(current.sessionId as TriState | undefined);
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'sessionId', result.sessionId);
  return next as ModelOverride;
}

export async function editNormalizeResponses(
  current: ModelOverride,
): Promise<ModelOverride> {
  const result = await collectNormalizeResponsesTriState(
    current.normalizeResponses as TriState | undefined,
  );
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'normalizeResponses', result.normalizeResponses);
  return next as ModelOverride;
}

export async function editCacheControl(
  current: ModelOverride,
  configPath?: string,
): Promise<ModelOverride> {
  const globalTtl = readGlobalTtl(configPath);
  const result = await collectCacheTriState(
    current.cacheControl as TriState | undefined,
    current.cacheControlTtl as '5m' | '1h' | 'omit' | 'skip' | undefined,
    globalTtl,
    current.rewriteBlockTtl as TriState | undefined,
  );
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'cacheControl', result.cacheControl);
  applyField(next, 'cacheControlTtl', result.cacheControlTtl);
  applyField(next, 'rewriteBlockTtl', result.rewriteBlockTtl);
  return next as ModelOverride;
}

export async function editNormalizeVolatileSystem(
  current: ModelOverride,
): Promise<ModelOverride> {
  const result = await collectNormalizeVolatileSystem(current.normalizeVolatileSystem);
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'normalizeVolatileSystem', result.normalizeVolatileSystem);
  return next as ModelOverride;
}
