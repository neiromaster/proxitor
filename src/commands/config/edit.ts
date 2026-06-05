import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import type { ModelOverride } from '../../config-schema.js'
import type { OpenRouterDataClient } from '../../openrouter/data-client.js'
import { getModelOverrides, requireConfigPath, setModelOverride } from './config.js'
import {
  fetchProvidersForModel,
  selectProvidersByMode,
  selectRoutingMode,
} from './providers.js'

function formatOverrideHint(override: ModelOverride | undefined): string {
  if (!override?.provider) return '(no provider routing)'
  const keys = Object.keys(override.provider)
  return keys
    .map(
      k => `${k}: ${JSON.stringify((override.provider as Record<string, unknown>)?.[k])}`,
    )
    .join(', ')
}

function showCurrentConfig(modelKey: string, current: ModelOverride): void {
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
}

function withoutProvider(current: ModelOverride): ModelOverride {
  return current.headers ? { headers: current.headers } : {}
}

async function updateProviderRouting(
  configPath: string,
  modelKey: string,
  current: ModelOverride,
  client: OpenRouterDataClient,
): Promise<void> {
  const isPattern = modelKey.includes('*')

  const mode = await selectRoutingMode('Routing mode')
  if (isCancel(mode)) return

  if (mode === 'skip') {
    setModelOverride(configPath, modelKey, withoutProvider(current))
    clack.outro('✓ Override updated')
    return
  }

  const providerOptions = await fetchProvidersForModel(client, modelKey, isPattern)
  if (!providerOptions) return

  const override = await selectProvidersByMode(mode as string, providerOptions)
  if (override === null) return

  const updated = withoutProvider(current)
  if (override.provider) {
    updated.provider = override.provider as ModelOverride['provider']
  }

  const save = await clack.confirm({ message: 'Save changes?' })
  if (isCancel(save) || !save) {
    clack.outro('Cancelled')
    return
  }

  setModelOverride(configPath, modelKey, updated)
  clack.outro('✓ Override updated')
}

/** Run the interactive "Edit model override" flow. */
export async function editOverrideCommand(client: OpenRouterDataClient): Promise<void> {
  clack.intro('Edit Model Override')

  const configPath = requireConfigPath()
  const overrides = getModelOverrides(configPath)
  const keys = Object.keys(overrides)

  if (keys.length === 0) {
    clack.log.warn('No model overrides found. Use Add instead.')
    clack.outro('')
    return
  }

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

  showCurrentConfig(modelKey, current)

  const target = await clack.select({
    message: 'What to change?',
    options: [
      { value: 'provider', label: 'Provider routing' },
      { value: 'replace', label: 'Replace entirely' },
    ],
  })
  if (isCancel(target)) return

  if (target === 'provider' || target === 'replace') {
    await updateProviderRouting(configPath, modelKey, current, client)
  }
}
