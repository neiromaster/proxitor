import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import type { ModelOverride } from '../../config-schema.js';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { perModelCachingMenu } from './caching-menu.js';
import { describeTtl } from './caching-summary.js';
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js';
import { overridesEqual } from './equality.js';
import { perModelFixesMenu } from './fixes-menu.js';
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js';

type EditField = 'provider' | 'caching' | 'fixes' | 'done';

function toggleHint(value: boolean | undefined): string {
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
    parts.push(`normalize: ${toggleHint(override.normalizeVolatileSystem)}`);
  if (override.normalizeResponses !== undefined)
    parts.push(`fix: ${toggleHint(override.normalizeResponses)}`);
  if (override.headers) parts.push(`${Object.keys(override.headers).length} header(s)`);
  return parts.join(', ') || '(empty)';
}

function formatCachingHint(current: ModelOverride): string {
  const cc = current.cacheControl ?? 'inherit';
  const ttl = current.cacheControlTtl ? describeTtl(current.cacheControlTtl) : 'inherit';
  const sid = current.sessionId ?? 'inherit';
  const nvs = toggleHint(current.normalizeVolatileSystem);
  return `cc ${cc} · ttl ${ttl} · sid ${sid} · nvs ${nvs}`;
}

function formatFixesHint(current: ModelOverride): string {
  return `normalizeResponses: ${current.normalizeResponses ?? 'inherit'}`;
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
        {
          value: 'fixes',
          label: '🛠 Fixes',
          hint: formatFixesHint(current),
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

    if (field === 'fixes') {
      current = await perModelFixesMenu({
        modelKey,
        current,
        configPath: resolvedConfigPath,
      });
      continue;
    }

    // field === 'provider' (caching + done handled above)
    const before = current;
    current = await editProvider(modelKey, current, client);
    if (!overridesEqual(current, before)) {
      setModelOverride(resolvedConfigPath, modelKey, current);
    }
  }

  clack.outro('✓ Done');
}
