import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { readConfigFile } from '../../config.js';
import type { ModelOverride, TriState } from '../../config-schema.js';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { perModelCachingMenu } from './caching-menu.js';
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js';
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js';
import {
  applyField,
  collectCacheTriState,
  collectNormalizeVolatileSystem,
  collectSessionTriState,
} from './tri-state.js';

type EditField = 'provider' | 'caching' | 'done';

function nvsHint(value: boolean | undefined): string {
  if (value === undefined) return '(inherit)';
  return value ? 'on' : 'off';
}

function formatOverrideHint(override: ModelOverride | undefined): string {
  if (!override) return '(empty)';
  const parts: string[] = [];
  if (override.provider) {
    const keys = Object.keys(override.provider);
    parts.push(`provider: ${keys.join(', ')}`);
  }
  if (override.sessionId) parts.push(`session: ${override.sessionId}`);
  if (override.cacheControl) parts.push(`cache: ${override.cacheControl}`);
  if (override.normalizeVolatileSystem !== undefined)
    parts.push(`normalize: ${nvsHint(override.normalizeVolatileSystem)}`);
  if (override.headers) parts.push(`${Object.keys(override.headers).length} header(s)`);
  return parts.join(', ') || '(empty)';
}

function formatCachingHint(current: ModelOverride): string {
  const cc = current.cacheControl ?? 'inherit';
  const sid = current.sessionId ?? 'inherit';
  const nvs = nvsHint(current.normalizeVolatileSystem);
  return `cc ${cc} · sid ${sid} · nvs ${nvs}`;
}

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

function showCurrentConfig(modelKey: string, current: ModelOverride): void {
  clack.log.info(`Current config for "${modelKey}":`);
  if (current.provider) {
    for (const [field, value] of Object.entries(current.provider)) {
      clack.log.info(`  provider.${field}: ${JSON.stringify(value)}`);
    }
  }
  if (current.sessionId) clack.log.info(`  sessionId: ${current.sessionId}`);
  if (current.cacheControl) clack.log.info(`  cacheControl: ${current.cacheControl}`);
  if (current.cacheControlTtl)
    clack.log.info(`  cacheControlTtl: ${current.cacheControlTtl}`);
  if (current.normalizeVolatileSystem !== undefined)
    clack.log.info(`  normalizeVolatileSystem: ${current.normalizeVolatileSystem}`);
  if (current.headers) {
    for (const [name, value] of Object.entries(current.headers)) {
      clack.log.info(`  headers.${name}: ${value}`);
    }
  }
}

async function editProvider(
  modelKey: string,
  current: ModelOverride,
  client: OpenRouterDataClient,
): Promise<ModelOverride> {
  const isPattern = modelKey.includes('*');

  const mode = await selectRoutingMode('Routing mode');
  if (isCancel(mode)) return current;

  if (mode === 'skip') {
    const { provider: _, ...rest } = current;
    return rest;
  }

  const providerOptions = await fetchProvidersForModel(client, modelKey, isPattern);
  if (!providerOptions) return current;

  const result = await selectProvidersByMode(mode as string, providerOptions);
  if (!result) return current;

  return { ...current, provider: (result as ModelOverride).provider };
}

/** @internal */
export async function editSessionId(current: ModelOverride): Promise<ModelOverride> {
  const result = await collectSessionTriState(current.sessionId as TriState | undefined);
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'sessionId', result.sessionId);
  return next as ModelOverride;
}

/** @internal */
export async function editCacheControl(
  current: ModelOverride,
  configPath?: string,
): Promise<ModelOverride> {
  const globalTtl = readGlobalTtl(configPath);
  const result = await collectCacheTriState(
    current.cacheControl as TriState | undefined,
    current.cacheControlTtl as '5m' | '1h' | 'omit' | 'skip' | undefined,
    globalTtl,
  );
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'cacheControl', result.cacheControl);
  applyField(next, 'cacheControlTtl', result.cacheControlTtl);
  return next as ModelOverride;
}

/** @internal */
export async function editNormalizeVolatileSystem(
  current: ModelOverride,
): Promise<ModelOverride> {
  const result = await collectNormalizeVolatileSystem(current.normalizeVolatileSystem);
  if (result === null) return current;

  const next: Record<string, unknown> = { ...current };
  applyField(next, 'normalizeVolatileSystem', result.normalizeVolatileSystem);
  return next as ModelOverride;
}

async function applyFieldEdit(
  field: EditField,
  modelKey: string,
  current: ModelOverride,
  client: OpenRouterDataClient,
): Promise<ModelOverride> {
  if (field === 'provider') {
    return editProvider(modelKey, current, client);
  }
  return current;
}

/** Run the interactive "Edit model override" flow. */
export async function editOverrideCommand(
  client: OpenRouterDataClient,
  configPath?: string,
): Promise<void> {
  clack.intro('Edit Model Override');

  const resolvedConfigPath = requireConfigPath(configPath);
  const overrides = getModelOverrides(resolvedConfigPath);
  const keys = Object.keys(overrides);

  if (keys.length === 0) {
    clack.log.warn('No model overrides found. Use Add instead.');
    clack.outro('');
    return;
  }

  const selected = await clack.select({
    message: 'Select override to edit',
    options: keys.map(k => ({
      value: k,
      label: k,
      hint: formatOverrideHint(overrides[k]),
    })),
  });
  if (isCancel(selected)) return;

  const modelKey = selected as string;
  let current: ModelOverride = overrides[modelKey] ?? {};

  showCurrentConfig(modelKey, current);

  for (;;) {
    const field = await clack.select<EditField>({
      message: 'Edit which field?',
      options: [
        {
          value: 'provider',
          label: 'Provider routing',
          hint: formatOverrideHint({ provider: current.provider }),
        },
        {
          value: 'caching',
          label: '💾 Caching',
          hint: formatCachingHint(current),
        },
        { value: 'done', label: '✓ Done' },
      ],
    });
    if (isCancel(field) || field === 'done') break;

    if (field === 'caching') {
      // Submenu self-persists; just refresh the local ref (no extra write).
      current = await perModelCachingMenu({
        modelKey,
        current,
        configPath: resolvedConfigPath,
      });
      continue;
    }

    const before = current;
    current = await applyFieldEdit(field, modelKey, current, client);
    if (current !== before) {
      setModelOverride(resolvedConfigPath, modelKey, current);
    }
  }

  clack.outro('✓ Done');
}
