import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { fetchModelEndpoints, getUniqueProviders } from '../../openrouter/endpoints.js';
import {
  fetchModels,
  formatPrice,
  parseModelAuthor,
  parseModelSlug,
} from '../../openrouter/models.js';
import type { OpenRouterModel } from '../../openrouter/types.js';
import { addOverrideCommand } from './add.js';
import {
  formatContextLength,
  formatLatency,
  formatModelHint,
  formatModelLabel,
  formatPricing,
  formatThroughput,
} from './format.js';

function toOption(m: OpenRouterModel) {
  return { value: m.id, label: formatModelLabel(m), hint: formatModelHint(m) };
}

function displayModelDetails(model: OpenRouterModel): void {
  clack.log.success(`${model.name || model.id}`);
  if (model.description) {
    const desc =
      model.description.length > 200
        ? `${model.description.slice(0, 200)}...`
        : model.description;
    clack.log.info(`  ${desc}`);
  }
  clack.log.info(`  Context: ${formatContextLength(model.context_length)} tokens`);
  if (model.top_provider?.max_completion_tokens) {
    clack.log.info(
      `  Max output: ${formatContextLength(model.top_provider.max_completion_tokens)} tokens`,
    );
  }
  clack.log.info(
    `  Pricing: ${formatPricing(model.pricing.prompt, model.pricing.completion)}`,
  );
  if (model.pricing.input_cache_read && model.pricing.input_cache_read !== '0') {
    clack.log.info(`  Cache read: ${formatPrice(model.pricing.input_cache_read)}`);
  }
  if (model.pricing.input_cache_write && model.pricing.input_cache_write !== '0') {
    clack.log.info(`  Cache write: ${formatPrice(model.pricing.input_cache_write)}`);
  }
  if (model.architecture?.modality) {
    clack.log.info(`  Modality: ${model.architecture.modality}`);
  }
  if (model.supported_parameters?.length) {
    clack.log.info(`  Parameters: ${model.supported_parameters.join(', ')}`);
  }
}

async function displayProviders(
  client: OpenRouterDataClient,
  model: OpenRouterModel,
): Promise<void> {
  const author = parseModelAuthor(model.id);
  const slug = parseModelSlug(model.id);
  const s = clack.spinner();
  s.start('Checking providers...');
  try {
    const endpoints = await fetchModelEndpoints(client, author, slug);
    const unique = getUniqueProviders(endpoints);
    s.stop(`${unique.length} providers available`);

    for (const p of unique) {
      const ep = endpoints.find(e => e.tag === p.tag);
      const latency = formatLatency(ep?.latency_last_30m?.p50 ?? null);
      const throughput = formatThroughput(ep?.throughput_last_30m?.p50 ?? null);
      clack.log.info(`    ${p.providerName} (${p.tag}) — ${latency} · ${throughput}`);
    }
  } catch {
    s.stop('Could not fetch providers');
  }
}

export async function browseModelsCommand(client: OpenRouterDataClient): Promise<void> {
  clack.intro('Browse Models');

  const s = clack.spinner();
  s.start('Loading models...');
  let models: OpenRouterModel[];
  try {
    models = await fetchModels(client);
    s.stop(`${models.length} models available`);
  } catch (error) {
    s.stop('Failed to load models');
    clack.log.error(String(error));
    return;
  }

  const modelId = await clack.autocomplete({
    message: 'Search for a model',
    placeholder: 'Type to search...',
    maxItems: 15,
    options(this: { userInput: string }) {
      const query = this.userInput.trim().toLowerCase();
      if (!query) return models.slice(0, 15).map(toOption);

      return models
        .filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query))
        .slice(0, 15)
        .map(toOption);
    },
    filter: (_search: string, _option: { value: string }) => true,
  });

  if (isCancel(modelId)) return;

  const model = models.find(m => m.id === modelId);
  if (!model) return;

  displayModelDetails(model);
  await displayProviders(client, model);

  const configure = await clack.confirm({
    message: `Configure routing for ${model.id}?`,
  });

  if (isCancel(configure) || !configure) {
    clack.outro('Bye!');
    return;
  }

  await addOverrideCommand({ client, presetModelId: model.id });
}
