import * as clack from '@clack/prompts';
import { formatPrice } from '../../openrouter/models.js';
import type { OpenRouterModel } from '../../openrouter/types.js';

type DisplayModelInfoOptions = {
  /** Use clack.log.success for the header line instead of clack.log.info */
  successHeader?: boolean;
  /** Show model description (truncated at 200 chars) */
  showDescription?: boolean;
  /** Show supported_parameters list */
  showParameters?: boolean;
};

function logNonZeroPrice(label: string, pricePerToken: string | undefined): void {
  if (pricePerToken && pricePerToken !== '0') {
    clack.log.info(`  ${label}: ${formatPrice(pricePerToken)}`);
  }
}

export function displayModelInfo(
  model: OpenRouterModel,
  options?: DisplayModelInfoOptions,
): void {
  const { successHeader, showDescription, showParameters } = options ?? {};

  if (successHeader) {
    clack.log.success(`${model.name || model.id}`);
  } else {
    clack.log.info(`${model.name || model.id}`);
  }

  if (showDescription && model.description) {
    const desc =
      model.description.length > 200
        ? `${model.description.slice(0, 200)}...`
        : model.description;
    clack.log.info(`  ${desc}`);
  }

  clack.log.info(`  Context: ${formatContextLength(model.context_length)} tokens`);

  if (model.top_provider.max_completion_tokens) {
    clack.log.info(
      `  Max output: ${formatContextLength(model.top_provider.max_completion_tokens)} tokens`,
    );
  }

  clack.log.info(
    `  Pricing: ${formatPricing(model.pricing.prompt, model.pricing.completion)}`,
  );

  logNonZeroPrice('Cache read', model.pricing.input_cache_read);
  logNonZeroPrice('Cache write', model.pricing.input_cache_write);

  if (model.architecture.modality) {
    clack.log.info(`  Modality: ${model.architecture.modality}`);
  }

  if (showParameters && model.supported_parameters.length) {
    clack.log.info(`  Parameters: ${model.supported_parameters.join(', ')}`);
  }
}

export function formatPricing(prompt: string, completion: string): string {
  return `${formatPrice(prompt)} / ${formatPrice(completion)}`;
}

/** `200000` → `"200k"`, `1000000` → `"1.0M"` */
export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}

/** `1137` → `"1.1s"`, `null` → `"N/A"` */
export function formatLatency(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatThroughput(tokensPerSec: number | null): string {
  if (tokensPerSec === null) return 'N/A';
  return `${tokensPerSec.toFixed(0)} t/s`;
}

export function formatModelLabel(m: OpenRouterModel): string {
  return `${m.name || m.id}  —  ${formatPrice(m.pricing.prompt)} · ${formatContextLength(m.context_length)}`;
}

export function formatModelHint(m: OpenRouterModel): string {
  const parts = [`out ${formatPrice(m.pricing.completion)}`];
  if (m.pricing.input_cache_read && m.pricing.input_cache_read !== '0') {
    parts.push(`cache ${formatPrice(m.pricing.input_cache_read)}`);
  }
  return parts.join(' · ');
}
