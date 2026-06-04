import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import type { ModelOverride } from '../../config-schema.js'
import { OpenRouterClient } from '../../openrouter/client.js'
import { fetchModelEndpoints, getUniqueProviders } from '../../openrouter/endpoints.js'
import { parseModelAuthor, parseModelSlug } from '../../openrouter/models.js'
import { fetchProviders } from '../../openrouter/providers.js'
import {
  formatLatency,
  formatThroughput,
  getModelOverrides,
  requireConfigPath,
  setModelOverride,
} from './shared.js'

/** Run the interactive "Edit model override" flow. */
export async function editOverrideCommand(apiKey: string): Promise<void> {
  clack.intro('Edit Model Override')

  const configPath = requireConfigPath()
  const overrides = getModelOverrides(configPath)
  const keys = Object.keys(overrides)

  if (keys.length === 0) {
    clack.log.warn('No model overrides found. Use Add instead.')
    clack.outro('')
    return
  }

  // Select which override to edit
  const selected = await clack.select({
    message: 'Select override to edit',
    options: keys.map(k => ({
      value: k,
      label: k,
      hint: formatOverrideHint(overrides[k]),
    })),
  })

  if (isCancel(selected)) return

  const modelKey = selected as string
  const current: ModelOverride = overrides[modelKey] ?? {}

  // Show current config
  clack.log.info(`Current config for "${modelKey}":`)
  if (current.provider) {
    for (const [field, value] of Object.entries(current.provider)) {
      clack.log.info(`  provider.${field}: ${JSON.stringify(value)}`)
    }
  }
  if (current.headers) {
    for (const [name, value] of Object.entries(current.headers)) {
      clack.log.info(`  headers.${name}: ${value}`)
    }
  }

  // What to change
  const target = await clack.select({
    message: 'What to change?',
    options: [
      { value: 'provider', label: 'Provider routing' },
      { value: 'replace', label: 'Replace entirely' },
    ],
  })

  if (isCancel(target)) return

  if (target === 'provider' || target === 'replace') {
    const isPattern = modelKey.includes('*')
    const client = new OpenRouterClient(apiKey)

    // Fetch providers
    let providerOptions: Array<{ value: string; label: string; hint?: string }>

    if (isPattern) {
      const s = clack.spinner()
      s.start('Fetching providers...')
      const providers = await fetchProviders(client)
      providerOptions = providers.map(p => ({ value: p.slug, label: p.name }))
      s.stop(`${providers.length} providers available`)
    } else {
      const author = parseModelAuthor(modelKey)
      const slug = parseModelSlug(modelKey)
      const s = clack.spinner()
      s.start('Fetching providers...')
      const endpoints = await fetchModelEndpoints(client, author, slug)
      const unique = getUniqueProviders(endpoints)
      providerOptions = unique.map(p => {
        const ep = endpoints.find(e => e.tag === p.tag)
        return {
          value: p.tag,
          label: `${p.providerName} (${p.tag})`,
          hint: `${formatLatency(ep?.latency_last_30m?.p50 ?? null)} · ${formatThroughput(ep?.throughput_last_30m?.p50 ?? null)}`,
        }
      })
      s.stop(`${unique.length} providers available`)
    }

    // Routing mode
    const mode = await clack.select({
      message: 'Routing mode',
      options: [
        { value: 'only', label: 'Use specific providers only' },
        { value: 'order', label: 'Set provider priority order' },
        { value: 'ignore', label: 'Ignore specific providers' },
        { value: 'skip', label: 'Remove provider routing' },
      ],
    })

    if (isCancel(mode)) return

    if (mode === 'skip') {
      const updated: ModelOverride = current.headers ? { headers: current.headers } : {}
      setModelOverride(configPath, modelKey, updated)
      clack.outro('✓ Override updated')
      return
    }

    // Select providers
    const selectedProviders = await clack.multiselect({
      message: 'Select providers',
      options: providerOptions,
      required: false,
    })

    if (isCancel(selectedProviders)) return

    const values = selectedProviders as string[]
    if (values.length === 0) {
      const updated: ModelOverride = current.headers ? { headers: current.headers } : {}
      setModelOverride(configPath, modelKey, updated)
      clack.outro('✓ Override updated (no providers)')
      return
    }

    const providerConfig: Record<string, unknown> = {}

    if (mode === 'only') {
      providerConfig.only = values.length === 1 ? values[0] : values
    } else if (mode === 'order') {
      providerConfig.order = values.length === 1 ? values[0] : values
      providerConfig.allowFallbacks = true
    } else if (mode === 'ignore') {
      providerConfig.ignore = values.length === 1 ? values[0] : values
    }

    const updated: ModelOverride = { ...current, provider: providerConfig }

    const save = await clack.confirm({ message: 'Save changes?' })
    if (isCancel(save) || !save) {
      clack.outro('Cancelled')
      return
    }

    setModelOverride(configPath, modelKey, updated)
    clack.outro('✓ Override updated')
  }
}

function formatOverrideHint(override: ModelOverride | undefined): string {
  if (!override?.provider) return '(no provider routing)'
  const keys = Object.keys(override.provider)
  return keys
    .map(
      k => `${k}: ${JSON.stringify((override.provider as Record<string, unknown>)?.[k])}`,
    )
    .join(', ')
}
