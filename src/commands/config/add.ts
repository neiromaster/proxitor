import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import { OpenRouterClient } from '../../openrouter/client.js'
import { fetchModels, formatPrice } from '../../openrouter/models.js'
import type { OpenRouterModel } from '../../openrouter/types.js'
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js'
import {
  formatContextLength,
  formatModelHint,
  formatModelLabel,
  formatPricing,
} from './format.js'
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js'

const CUSTOM_PATTERN = '__custom_pattern__'

/** Run the interactive "Add model override" flow. */
export async function addOverrideCommand(apiKey: string): Promise<void> {
  clack.intro('Add Model Override')

  const configPath = requireConfigPath()
  const client = new OpenRouterClient(apiKey)

  const models = await loadModelsWithSpinner(client)
  if (!models) return

  const modelId = await searchModel(models)
  if (!modelId) return

  if (typeof modelId !== 'string') return

  if (modelId === CUSTOM_PATTERN) {
    const pattern = await enterPattern(models)
    if (!pattern) return

    const existing = getModelOverrides(configPath)
    if (existing[pattern]) {
      clack.log.warn(`Override for "${pattern}" already exists. Use Edit instead.`)
      return
    }

    await configureProviderAndSave(configPath, client, pattern, true)
    return
  }

  const selected = models.find(m => m.id === modelId)
  if (selected) displayModelInfo(selected)

  const existing = getModelOverrides(configPath)
  if (existing[modelId]) {
    clack.log.warn(`Override for "${modelId}" already exists. Use Edit instead.`)
    return
  }

  await configureProviderAndSave(configPath, client, modelId, false)
}

async function loadModelsWithSpinner(
  client: OpenRouterClient,
): Promise<OpenRouterModel[] | null> {
  const s = clack.spinner()
  s.start('Loading models from OpenRouter...')
  try {
    const models = await fetchModels(client)
    s.stop(`${models.length} models available`)
    return models
  } catch (error) {
    s.stop('Failed to load models')
    clack.log.error(String(error))
    return null
  }
}

async function searchModel(models: OpenRouterModel[]): Promise<string | symbol | null> {
  const result = await clack.autocomplete({
    message: 'Search for a model',
    placeholder: 'Type to search (e.g. "claude", "gpt-4o", "qwen")',
    maxItems: 15,
    options(this: { userInput: string }) {
      const query = this.userInput.trim().toLowerCase()

      if (!query) {
        return [
          {
            value: CUSTOM_PATTERN,
            label: '✏️  Enter custom pattern (e.g. "claude-*")',
          },
        ]
      }

      const filtered = models
        .filter(m => {
          const text = `${m.id} ${m.name}`.toLowerCase()
          return text.includes(query)
        })
        .slice(0, 14)
        .map(m => ({
          value: m.id,
          label: formatModelLabel(m),
          hint: formatModelHint(m),
        }))

      return [
        ...filtered,
        { value: CUSTOM_PATTERN, label: '✏️  Enter custom pattern (e.g. "claude-*")' },
      ]
    },
    filter: (_search: string, _option: { value: string }) => true,
  })

  if (isCancel(result)) return null
  return result as string
}

async function enterPattern(models: OpenRouterModel[]): Promise<string | null> {
  const pattern = await clack.text({
    message: 'Enter model pattern',
    placeholder: 'e.g. claude-*, gpt-4*, anthropic/*',
    validate: v => {
      if (!v?.trim()) return 'Pattern cannot be empty'
      return undefined
    },
  })

  if (isCancel(pattern)) return null

  const pat = (pattern as string).trim()
  const matches = countPatternMatches(pat, models)
  if (matches > 0) {
    clack.log.info(`Pattern "${pat}" matches ${matches} model(s)`)
  } else {
    clack.log.warn(
      `Pattern "${pat}" does not match any current models — it will still be saved`,
    )
  }

  return pat
}

async function configureProviderAndSave(
  configPath: string,
  client: OpenRouterClient,
  modelKey: string,
  isPattern: boolean,
): Promise<void> {
  const mode = await selectRoutingMode('Configure provider routing')
  if (isCancel(mode)) return

  if (mode === 'skip') {
    setModelOverride(configPath, modelKey, {})
    clack.outro('Done — override saved without provider routing')
    return
  }

  const providerOptions = await fetchProvidersForModel(client, modelKey, isPattern)
  if (!providerOptions) return

  const override = await selectProvidersByMode(mode as string, providerOptions)
  if (!override) return

  clack.log.info(
    `Proposed override:\n  ${modelKey}:\n    ${formatOverrideYaml(override)}`,
  )

  const save = await clack.confirm({ message: 'Save to config?' })
  if (isCancel(save) || !save) {
    clack.outro('Cancelled')
    return
  }

  setModelOverride(configPath, modelKey, override)
  clack.outro('✓ Model override saved')
}

function displayModelInfo(model: OpenRouterModel): void {
  clack.log.info(`${model.name || model.id}`)
  clack.log.info(`  Context: ${formatContextLength(model.context_length)} tokens`)
  clack.log.info(
    `  Pricing: ${formatPricing(model.pricing.prompt, model.pricing.completion)}`,
  )
  if (model.pricing.input_cache_read && model.pricing.input_cache_read !== '0') {
    clack.log.info(`  Cache read: ${formatPrice(model.pricing.input_cache_read)}`)
  }
  if (model.pricing.input_cache_write && model.pricing.input_cache_write !== '0') {
    clack.log.info(`  Cache write: ${formatPrice(model.pricing.input_cache_write)}`)
  }
  if (model.top_provider?.max_completion_tokens) {
    clack.log.info(
      `  Max output: ${formatContextLength(model.top_provider.max_completion_tokens)} tokens`,
    )
  }
  if (model.architecture?.modality) {
    clack.log.info(`  Modality: ${model.architecture.modality}`)
  }
}

function countPatternMatches(pattern: string, models: OpenRouterModel[]): number {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return models.filter(m => m.id.startsWith(prefix)).length
  }
  return models.filter(m => m.id === pattern).length
}

function formatOverrideYaml(override: Record<string, unknown>): string {
  const parts: string[] = []
  if (override.provider && typeof override.provider === 'object') {
    const p = override.provider as Record<string, unknown>
    for (const [key, value] of Object.entries(p)) {
      parts.push(`provider.${key}: ${JSON.stringify(value)}`)
    }
  }
  return parts.join('\n    ') || '(empty)'
}
