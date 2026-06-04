import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import { OpenRouterClient } from '../../openrouter/client.js'
import { fetchModelEndpoints, getUniqueProviders } from '../../openrouter/endpoints.js'
import {
  fetchModels,
  formatPrice,
  parseModelAuthor,
  parseModelSlug,
} from '../../openrouter/models.js'
import type { OpenRouterModel } from '../../openrouter/types.js'
import { addOverrideCommand } from './add.js'
import {
  formatContextLength,
  formatLatency,
  formatModelHint,
  formatModelLabel,
  formatPricing,
  formatThroughput,
} from './shared.js'

/** Run the interactive "Browse models" flow. */
export async function browseModelsCommand(apiKey: string): Promise<void> {
  clack.intro('Browse Models')

  const client = new OpenRouterClient(apiKey)

  // Load models
  const s = clack.spinner()
  s.start('Loading models...')
  let models: OpenRouterModel[]
  try {
    models = await fetchModels(client)
    s.stop(`${models.length} models available`)
  } catch (error) {
    s.stop('Failed to load models')
    clack.log.error(String(error))
    return
  }

  // Search
  const modelId = await clack.autocomplete({
    message: 'Search for a model',
    placeholder: 'Type to search...',
    maxItems: 15,
    options(this: { userInput: string }) {
      const query = this.userInput.trim().toLowerCase()
      if (!query) return models.slice(0, 15).map(toOption)

      return models
        .filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query))
        .slice(0, 15)
        .map(toOption)
    },
    filter: (_search: string, _option: { value: string }) => true,
  })

  if (isCancel(modelId)) return

  const model = models.find(m => m.id === modelId)
  if (!model) return

  // Display rich info
  clack.log.success(`${model.name || model.id}`)
  if (model.description) {
    clack.log.info(
      `  ${model.description.slice(0, 200)}${model.description.length > 200 ? '...' : ''}`,
    )
  }
  clack.log.info(`  Context: ${formatContextLength(model.context_length)} tokens`)
  if (model.top_provider?.max_completion_tokens) {
    clack.log.info(
      `  Max output: ${formatContextLength(model.top_provider.max_completion_tokens)} tokens`,
    )
  }
  clack.log.info(
    `  Pricing: ${formatPricing(model.pricing.prompt, model.pricing.completion)}`,
  )
  if (model.pricing.input_cache_read && model.pricing.input_cache_read !== '0') {
    clack.log.info(`  Cache read: ${formatPrice(model.pricing.input_cache_read)}`)
  }
  if (model.pricing.input_cache_write && model.pricing.input_cache_write !== '0') {
    clack.log.info(`  Cache write: ${formatPrice(model.pricing.input_cache_write)}`)
  }
  if (model.architecture?.modality) {
    clack.log.info(`  Modality: ${model.architecture.modality}`)
  }
  if (model.supported_parameters?.length) {
    clack.log.info(`  Parameters: ${model.supported_parameters.join(', ')}`)
  }

  // Fetch endpoints count
  const author = parseModelAuthor(model.id)
  const slug = parseModelSlug(model.id)
  const se = clack.spinner()
  se.start('Checking providers...')
  try {
    const endpoints = await fetchModelEndpoints(client, author, slug)
    const unique = getUniqueProviders(endpoints)
    se.stop(`${unique.length} providers available`)

    for (const p of unique) {
      const ep = endpoints.find(e => e.tag === p.tag)
      const latency = formatLatency(ep?.latency_last_30m?.p50 ?? null)
      const throughput = formatThroughput(ep?.throughput_last_30m?.p50 ?? null)
      clack.log.info(`    ${p.providerName} (${p.tag}) — ${latency} · ${throughput}`)
    }
  } catch {
    se.stop('Could not fetch providers')
  }

  // Offer to configure
  const configure = await clack.confirm({
    message: `Configure routing for ${model.id}?`,
  })

  if (isCancel(configure) || !configure) {
    clack.outro('Bye!')
    return
  }

  // Redirect to add flow
  await addOverrideCommand(apiKey)
}

function toOption(m: OpenRouterModel) {
  return { value: m.id, label: formatModelLabel(m), hint: formatModelHint(m) }
}
