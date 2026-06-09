import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { matchesPattern, resolveModelConfig } from '../../config.js';
import type { ModelOverride } from '../../config-schema.js';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { fetchModels, formatPrice } from '../../openrouter/models.js';
import type { OpenRouterModel } from '../../openrouter/types.js';
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js';
import {
  formatContextLength,
  formatModelHint,
  formatModelLabel,
  formatPricing,
} from './format.js';
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js';

// Sentinel value for the "enter custom pattern" option in autocomplete. Uses
// a string because @clack/prompts' autocomplete `value` field is typed `string`.
// Picked to be unguessable as a real model id (real ids use `/` separators).
const CUSTOM_PATTERN_VALUE = '__proxitor_custom_pattern__';

type AddOptions = {
  client: OpenRouterDataClient;
  presetModelId?: string | undefined;
};

/** Run the interactive "Add model override" flow. */
export async function addOverrideCommand(opts: AddOptions): Promise<void> {
  clack.intro('Add Model Override');
  const { client, presetModelId } = opts;

  const configPath = requireConfigPath();
  const existing = getModelOverrides(configPath);

  const models = await loadModelsWithSpinner(client);
  if (!models) return;

  // If a preset was passed in (e.g. from `browse`), skip search.
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

  // Pre-check duplicate — done BEFORE asking about routing so the user
  // doesn't waste time configuring providers for a key that's already set.
  if (existing[modelId]) {
    clack.log.warn(
      `Override for "${modelId}" already exists. Use \`proxitor config edit\` to change it.`,
    );
    clack.outro('No changes written.');
    return;
  }

  // If the user typed a free-form model id (not from the list), show what
  // we know about it from the loaded data; otherwise show the picked model.
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

async function configureProviderAndSave(
  configPath: string,
  client: OpenRouterDataClient,
  modelKey: string,
  isPattern: boolean,
): Promise<void> {
  const mode = await selectRoutingMode('Configure provider routing');
  if (isCancel(mode)) return;

  if (mode === 'skip') {
    const empty: ModelOverride = {};
    if (!(await confirmAndSave(configPath, modelKey, empty, client))) return;
    clack.outro('✓ Override saved (no provider routing)');
    return;
  }

  const providerOptions = await fetchProvidersForModel(client, modelKey, isPattern);
  if (!providerOptions) return;

  const override = await selectProvidersByMode(mode as string, providerOptions);
  if (!override) return;

  if (!(await confirmAndSave(configPath, modelKey, override as ModelOverride, client)))
    return;
  clack.outro('✓ Model override saved');
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
  while (true) {
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
        // Best-effort: pass a minimal stub config with just the override.
        // Without the full file, we can't apply global defaults, but for a
        // dry-run it's enough to show what the override itself produces.
        {
          host: '0.0.0.0',
          port: 0,
          openrouterKey: '',
          openrouterBaseUrl: 'https://openrouter.ai/api',
          authType: 'bearer',
          verbose: false,
          bodyLimit: '50mb',
          attributionReferer: '',
          attributionTitle: '',
          cacheControl: 'auto',
          sessionId: 'auto',
          modelOverrides: { [modelKey]: override },
        } as Parameters<typeof resolveModelConfig>[0],
        modelKey,
      );
      clack.note(
        `provider: ${JSON.stringify(resolved.provider ?? null)}\n` +
          `headers: ${JSON.stringify(resolved.headers ?? {})}`,
        `Dry-run resolve for "${modelKey}"`,
      );
      // Re-prompt after the test.
      continue;
    }

    setModelOverride(configPath, modelKey, override);
    return true;
  }
}

function displayModelInfo(model: OpenRouterModel): void {
  clack.log.info(`${model.name || model.id}`);
  clack.log.info(`  Context: ${formatContextLength(model.context_length)} tokens`);
  clack.log.info(
    `  Pricing: ${formatPricing(model.pricing.prompt, model.pricing.completion)}`,
  );
  if (model.pricing.input_cache_read && model.pricing.input_cache_read !== '0') {
    clack.log.info(`  Cache read: ${formatPrice(model.pricing.input_cache_read)}`);
  }
  if (model.pricing.input_cache_write && model.pricing.input_cache_write !== '0') {
    clack.log.info(`  Cache write: ${formatPrice(model.pricing.input_cache_write)}`);
  }
  if (model.top_provider?.max_completion_tokens) {
    clack.log.info(
      `  Max output: ${formatContextLength(model.top_provider.max_completion_tokens)} tokens`,
    );
  }
  if (model.architecture?.modality) {
    clack.log.info(`  Modality: ${model.architecture.modality}`);
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
  return parts.join('\n    ') || '(empty)';
}
