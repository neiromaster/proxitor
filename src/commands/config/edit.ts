import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { readConfigFile } from '../../config.js';
import type { ModelOverride, TriState } from '../../config-schema.js';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js';
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js';
import { applyField, collectCacheTriState, collectSessionTriState } from './tri-state.js';

type EditField = 'provider' | 'sessionId' | 'cacheControl' | 'done';

function formatOverrideHint(override: ModelOverride | undefined): string {
  if (!override) return '(empty)';
  const parts: string[] = [];
  if (override.provider) {
    const keys = Object.keys(override.provider);
    parts.push(`provider: ${keys.join(', ')}`);
  }
  if (override.sessionId) parts.push(`session: ${override.sessionId}`);
  if (override.cacheControl) parts.push(`cache: ${override.cacheControl}`);
  if (override.headers) parts.push(`${Object.keys(override.headers).length} header(s)`);
  return parts.join(', ') || '(empty)';
}

function formatCacheHint(
  cc: TriState | undefined,
  ttl: '5m' | '1h' | 'omit' | 'skip' | undefined,
): string {
  let ttlLabel = ttl ?? '';
  if (ttl === 'omit') ttlLabel = 'ttl strip';
  else if (ttl === 'skip') ttlLabel = 'ttl passthrough';
  return [cc, ttlLabel].filter(Boolean).join(', ') || '(inherit)';
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

async function editSessionId(current: ModelOverride): Promise<ModelOverride> {
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
          value: 'sessionId',
          label: 'Session ID',
          hint: current.sessionId ?? '(inherit)',
        },
        {
          value: 'cacheControl',
          label: 'Cache control',
          hint: formatCacheHint(current.cacheControl, current.cacheControlTtl),
        },
        { value: 'done', label: '✓ Done' },
      ],
    });
    if (isCancel(field) || field === 'done') break;

    switch (field) {
      case 'provider':
        current = await editProvider(modelKey, current, client);
        break;
      case 'sessionId':
        current = await editSessionId(current);
        break;
      case 'cacheControl':
        current = await editCacheControl(current, resolvedConfigPath);
        break;
    }
  }

  const save = await clack.confirm({ message: 'Save changes?' });
  if (isCancel(save) || !save) {
    clack.outro('Cancelled');
    return;
  }

  setModelOverride(resolvedConfigPath, modelKey, current);
  clack.outro('✓ Override updated');
}
