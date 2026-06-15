import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { matchesPattern, resolveModelConfig } from '../../config.js';
import { DEFAULTS, type ModelOverride } from '../../config-schema.js';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { fetchModels } from '../../openrouter/models.js';
import type { OpenRouterModel } from '../../openrouter/types.js';
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js';
import { displayModelInfo, formatModelHint, formatModelLabel } from './format.js';
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js';
import { collectCacheTriState, collectSessionTriState } from './tri-state.js';

const CUSTOM_PATTERN_VALUE = '__proxitor_custom_pattern__';

type AddOptions = {
  client: OpenRouterDataClient;
  configPath?: string | undefined;
  presetModelId?: string | undefined;
};

/** Run the interactive "Add model override" flow. */
export async function addOverrideCommand(opts: AddOptions): Promise<void> {
  clack.intro('Add Model Override');
  const { client, presetModelId } = opts;

  const configPath = requireConfigPath(opts.configPath);
  const existing = getModelOverrides(configPath);

  const models = await loadModelsWithSpinner(client);
  if (!models) return;

  let modelId: string | null = presetModelId ?? null;
  if (modelId === null) {
    const picked = await searchModel(models);
    if (!picked) return;
    if (picked === CUSTOM_PATTERN_VALUE) {
      const pattern = await enterPattern(models);
      if (!pattern) return;
      modelId = pattern;
    } else {
      modelId = picked;
    }
  }

  if (existing[modelId]) {
    clack.log.warn(
      `Override for "${modelId}" already exists. Use \`proxitor config edit\` to change it.`,
    );
    clack.outro('No changes written.');
    return;
  }

  if (presetModelId === undefined) {
    const selected = models.find(m => m.id === modelId);
    if (selected) displayModelInfo(selected);
  }

  await configureProviderAndSave(
    configPath,
    client,
    modelId,
    /* isPattern */ modelId.includes('*'),
  );
}

async function loadModelsWithSpinner(
  client: OpenRouterDataClient,
): Promise<OpenRouterModel[] | null> {
  const s = clack.spinner();
  s.start('Loading models from OpenRouter...');
  try {
    const models = await fetchModels(client);
    s.stop(`${models.length} models available`);
    return models;
  } catch (error) {
    s.stop('Failed to load models');
    clack.log.error(String(error));
    return null;
  }
}

async function searchModel(models: OpenRouterModel[]): Promise<string | null> {
  const result = await clack.autocomplete({
    message: 'Search for a model',
    placeholder: 'Type to search (e.g. "claude", "gpt-4o", "qwen")',
    maxItems: 15,
    options(this: { userInput: string }) {
      const query = this.userInput.trim().toLowerCase();

      if (!query) {
        return [
          {
            value: CUSTOM_PATTERN_VALUE,
            label: '✏️  Enter custom pattern (e.g. "claude-*")',
          },
        ];
      }

      const filtered = models
        .filter(m => {
          const text = `${m.id} ${m.name}`.toLowerCase();
          return text.includes(query);
        })
        .slice(0, 14)
        .map(m => ({
          value: m.id,
          label: formatModelLabel(m),
          hint: formatModelHint(m),
        }));

      return [
        ...filtered,
        {
          value: CUSTOM_PATTERN_VALUE,
          label: '✏️  Enter custom pattern (e.g. "claude-*")',
        },
      ];
    },
    filter: () => true,
  });

  if (isCancel(result)) return null;
  return result as string;
}

async function enterPattern(models: OpenRouterModel[]): Promise<string | null> {
  const pattern = await clack.text({
    message: 'Enter model pattern',
    placeholder: 'e.g. claude-*, gpt-4*, anthropic/*',
    validate: v => {
      if (!v?.trim()) return 'Pattern cannot be empty';
      return undefined;
    },
  });

  if (isCancel(pattern)) return null;

  const pat = (pattern as string).trim();
  const matchCount = models.filter(m => matchesPattern(pat, m.id)).length;
  if (matchCount > 0) {
    clack.log.info(`Pattern "${pat}" matches ${matchCount} model(s)`);
  } else {
    clack.log.warn(
      `Pattern "${pat}" does not match any current models — it will still be saved`,
    );
  }

  return pat;
}

/** @internal */
export async function configureProviderAndSave(
  configPath: string,
  client: OpenRouterDataClient,
  modelKey: string,
  isPattern: boolean,
): Promise<void> {
  const mode = await selectRoutingMode('Configure provider routing');
  if (isCancel(mode)) return;

  let override: ModelOverride = {};

  if (mode === 'skip') {
    // Short-circuit: save a bare override without session/cache prompts
    if (!(await confirmAndSave(configPath, modelKey, override, client))) return;
    clack.outro('✓ Model override saved (no provider routing)');
    return;
  }

  const providerOptions = await fetchProvidersForModel(client, modelKey, isPattern);
  if (!providerOptions) return;

  const providerResult = await selectProvidersByMode(mode as string, providerOptions);
  if (!providerResult) return;
  override = providerResult as ModelOverride;

  override = await collectSessionAndCache(override);

  if (!(await confirmAndSave(configPath, modelKey, override, client))) return;
  clack.outro('✓ Model override saved');
}

async function collectSessionAndCache(override: ModelOverride): Promise<ModelOverride> {
  override = await collectSession(override);
  override = await collectCache(override);
  return override;
}

async function collectSession(override: ModelOverride): Promise<ModelOverride> {
  const want = await clack.confirm({
    message: 'Configure session routing for this model?',
    initialValue: false,
  });
  if (isCancel(want) || !want) return override;

  const result = await collectSessionTriState();
  if (result && !('remove' in result.sessionId))
    override.sessionId = result.sessionId.value;
  return override;
}

async function collectCache(override: ModelOverride): Promise<ModelOverride> {
  const want = await clack.confirm({
    message: 'Configure cache control for this model?',
    initialValue: false,
  });
  if (isCancel(want) || !want) return override;

  const result = await collectCacheTriState();
  if (result) {
    if (!('remove' in result.cacheControl))
      override.cacheControl = result.cacheControl.value;
    if (result.cacheControlTtl && !('remove' in result.cacheControlTtl)) {
      override.cacheControlTtl = result.cacheControlTtl.value;
    }
  }
  return override;
}

/**
 * Show the proposed override and let the user Save / Test (dry-run) / Cancel.
 * Returns true if the override was saved.
 */
async function confirmAndSave(
  configPath: string,
  modelKey: string,
  override: ModelOverride,
  _client: OpenRouterDataClient,
): Promise<boolean> {
  for (;;) {
    clack.log.info(
      `Proposed override:\n  ${modelKey}:\n    ${formatOverrideYaml(override)}`,
    );

    // Dry-run: resolve the override against the model id and show what would
    // happen. Useful for catching typos in `only` / `order` before persisting.
    const action = await clack.select({
      message: 'What next?',
      options: [
        { value: 'save', label: 'Save to config' },
        { value: 'test', label: 'Test (dry-run against this model)' },
        { value: 'cancel', label: 'Cancel' },
      ],
      initialValue: 'save',
    });
    if (isCancel(action) || action === 'cancel') {
      clack.outro('Cancelled');
      return false;
    }

    if (action === 'test') {
      const resolved = resolveModelConfig(
        // Spread DEFAULTS so the stub stays in sync with the schema — no
        // hand-typed fields that drift when new required keys are added.
        { ...DEFAULTS, modelOverrides: { [modelKey]: override } },
        modelKey,
      );
      clack.note(
        `provider: ${JSON.stringify(resolved.provider ?? null)}\n` +
          `headers: ${JSON.stringify(resolved.headers ?? {})}`,
        `Dry-run resolve for "${modelKey}"`,
      );
      continue;
    }

    setModelOverride(configPath, modelKey, override);
    return true;
  }
}

function formatOverrideYaml(override: Record<string, unknown>): string {
  const parts: string[] = [];
  if (override.provider && typeof override.provider === 'object') {
    const p = override.provider as Record<string, unknown>;
    for (const [key, value] of Object.entries(p)) {
      parts.push(`provider.${key}: ${JSON.stringify(value)}`);
    }
  }
  if (override.sessionId) parts.push(`sessionId: ${override.sessionId}`);
  if (override.cacheControl) parts.push(`cacheControl: ${override.cacheControl}`);
  if (override.cacheControlTtl)
    parts.push(`cacheControlTtl: ${override.cacheControlTtl}`);
  return parts.join('\n    ') || '(empty)';
}
