import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { parseModelAuthor, parseModelSlug } from '../../model-id.js';
import type { OpenRouterDataClient } from '../../openrouter/data-client.js';
import { getUniqueProviders } from '../../openrouter/models.js';
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
    const endpoints = await client.fetchModelEndpoints(author, slug);
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
  // Empty provider list (e.g. a model alias with no endpoint data) crashes
  // clack.multiselect — bail. Callers treat null as "no changes".
  if (providerOptions.length === 0) {
    clack.log.warn(
      'No providers available for this model — cannot configure provider routing.',
    );
    return null;
  }
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
  // Step 1: pick the set of providers that may serve this model.
  const picked = await clack.multiselect({
    message: 'Select providers to try (in any order)',
    options: providerOptions,
    required: true,
  });
  if (clack.isCancel(picked)) return null;
  const candidates = picked as string[];

  // Step 2: assign a priority to each. Lower number = tried first.
  // We use plain text input so the user can re-run and adjust any time,
  // instead of being locked into the order they added items in step 1.
  const priorityByValue = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i];
    const opt = providerOptions.find(p => p.value === value);
    const label = opt?.label ?? value;
    const initial = String(i + 1);
    const ans = await clack.text({
      message: `Priority for "${label}" (1 = first, 2 = second, ...)`,
      placeholder: initial,
      initialValue: initial,
      validate: v => {
        if (!v?.trim()) return 'Priority is required';
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n) || n < 1) return 'Must be a positive integer';
        return undefined;
      },
    });
    if (isCancel(ans)) return null;
    const ansStr = ans ?? '';
    // candidates[i] is string|undefined under noUncheckedIndexedAccess; narrow here.
    if (value === undefined) continue;
    priorityByValue.set(value, Number.parseInt(ansStr, 10));
  }

  // Sort by priority, then by the original selection order to break ties
  // (so the first pick with priority=1 wins over the second with priority=1).
  const order = [...candidates].sort((a, b) => {
    const pa = priorityByValue.get(a) ?? Number.MAX_SAFE_INTEGER;
    const pb = priorityByValue.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return candidates.indexOf(a) - candidates.indexOf(b);
  });

  const allowFallbacks = await clack.confirm({
    message: 'Allow fallbacks to other providers?',
    initialValue: true,
  });
  // Accept the default on cancel: the user already chose providers, and this
  // confirm has an explicit initialValue intent (true).
  const fallbacksEnabled = isCancel(allowFallbacks) ? true : (allowFallbacks as boolean);

  return {
    provider: {
      order: order.length === 1 ? order[0] : order,
      allowFallbacks: fallbacksEnabled,
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
