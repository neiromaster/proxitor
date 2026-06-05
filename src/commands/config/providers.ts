import * as clack from '@clack/prompts';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { fetchModelEndpoints, getUniqueProviders } from '../../openrouter/endpoints.js';
import { parseModelAuthor, parseModelSlug } from '../../openrouter/models.js';
import { fetchProviders } from '../../openrouter/providers.js';
import { formatLatency, formatThroughput } from './format.js';

export async function fetchProvidersForPattern(
  client: OpenRouterDataClient,
): Promise<Array<{ value: string; label: string; hint?: string }> | null> {
  const s = clack.spinner();
  s.start('Fetching providers...');
  try {
    const providers = await fetchProviders(client);
    const options = providers
      .map(p => ({ value: p.slug, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    s.stop(`${providers.length} providers available`);
    return options;
  } catch (error) {
    s.stop('Failed to fetch providers');
    clack.log.error(String(error));
    return null;
  }
}

export async function fetchEndpointsForModel(
  client: OpenRouterDataClient,
  modelId: string,
): Promise<Array<{ value: string; label: string; hint?: string }> | null> {
  const author = parseModelAuthor(modelId);
  const slug = parseModelSlug(modelId);

  const s = clack.spinner();
  s.start('Fetching providers for this model...');
  try {
    const endpoints = await fetchModelEndpoints(client, author, slug);
    const unique = getUniqueProviders(endpoints);

    const options = unique.map(p => {
      const ep = endpoints.find(e => e.tag === p.tag);
      const latency = ep?.latency_last_30m?.p50 ?? null;
      const throughput = ep?.throughput_last_30m?.p50 ?? null;
      return {
        value: p.tag,
        label: `${p.providerName} (${p.tag})`,
        hint: `${formatLatency(latency)} · ${formatThroughput(throughput)}`,
      };
    });

    s.stop(`${unique.length} providers available for this model`);
    return options;
  } catch (error) {
    s.stop('Failed to fetch providers');
    clack.log.error(String(error));
    return null;
  }
}

export async function fetchProvidersForModel(
  client: OpenRouterDataClient,
  modelKey: string,
  isPattern: boolean,
): Promise<Array<{ value: string; label: string; hint?: string }> | null> {
  if (isPattern) return fetchProvidersForPattern(client);
  return fetchEndpointsForModel(client, modelKey);
}

const DONE_OPTION = '__done__';

export async function selectRoutingMode(message: string): Promise<string | symbol> {
  return clack.select({
    message,
    options: [
      { value: 'only', label: 'Use specific providers only' },
      { value: 'order', label: 'Set provider priority order' },
      { value: 'ignore', label: 'Ignore specific providers' },
      { value: 'skip', label: 'Skip provider routing' },
    ],
  });
}

export async function selectProvidersByMode(
  mode: string,
  providerOptions: Array<{ value: string; label: string; hint?: string }>,
): Promise<Record<string, unknown> | null> {
  if (mode === 'only') return selectOnlyProviders(providerOptions);
  if (mode === 'order') return selectOrderedProviders(providerOptions);
  if (mode === 'ignore') return selectIgnoreProviders(providerOptions);
  return null;
}

async function selectOnlyProviders(
  providerOptions: Array<{ value: string; label: string; hint?: string }>,
): Promise<Record<string, unknown> | null> {
  const selected = await clack.multiselect({
    message: 'Select providers',
    options: providerOptions,
    required: false,
  });

  if (clack.isCancel(selected)) return null;

  const values = selected as string[];
  if (values.length === 0) return {};

  const only = values.length === 1 ? values[0] : values;
  return { provider: { only } };
}

async function selectOrderedProviders(
  providerOptions: Array<{ value: string; label: string; hint?: string }>,
): Promise<Record<string, unknown> | null> {
  const order: string[] = [];

  for (let i = 1; ; i++) {
    const remaining = providerOptions.filter(p => !order.includes(p.value));
    if (remaining.length === 0) break;

    const pick = await clack.select({
      message: `Select provider #${i} (or cancel to finish)`,
      options: [...remaining, { value: DONE_OPTION, label: '✓ Done' }],
    });

    if (clack.isCancel(pick) || pick === DONE_OPTION) break;
    order.push(pick as string);
  }

  if (order.length === 0) {
    clack.log.warn('No providers selected');
    return null;
  }

  const allowFallbacks = await clack.confirm({
    message: 'Allow fallbacks to other providers?',
    initialValue: true,
  });

  return {
    provider: {
      order: order.length === 1 ? order[0] : order,
      allowFallbacks: clack.isCancel(allowFallbacks) ? true : (allowFallbacks as boolean),
    },
  };
}

async function selectIgnoreProviders(
  providerOptions: Array<{ value: string; label: string; hint?: string }>,
): Promise<Record<string, unknown> | null> {
  const selected = await clack.multiselect({
    message: 'Select providers to ignore',
    options: providerOptions,
    required: false,
  });

  if (clack.isCancel(selected)) return null;

  const values = selected as string[];
  if (values.length === 0) return {};

  const ignore = values.length === 1 ? values[0] : values;
  return { provider: { ignore } };
}
