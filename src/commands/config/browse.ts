import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { rankModels } from '../../openrouter/fuzzy.js';
import {
  fetchModels,
  getUniqueProviders,
  parseModelAuthor,
  parseModelSlug,
} from '../../openrouter/models.js';
import type { OpenRouterModel } from '../../openrouter/types.js';
import { addOverrideCommand } from './add.js';
import {
  displayModelInfo,
  formatLatency,
  formatModelHint,
  formatModelLabel,
  formatThroughput,
} from './format.js';

function toOption(m: OpenRouterModel) {
  return { value: m.id, label: formatModelLabel(m), hint: formatModelHint(m) };
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
    const endpoints = await client.fetchModelEndpoints(author, slug);
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
      return rankModels(models, this.userInput).slice(0, 15).map(toOption);
    },
    filter: (_search: string, _option: { value: string }) => true,
  });

  if (isCancel(modelId)) return;

  const model = models.find(m => m.id === modelId);
  if (!model) return;

  displayModelInfo(model, {
    successHeader: true,
    showDescription: true,
    showParameters: true,
  });
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
