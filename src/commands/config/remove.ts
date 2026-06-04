import * as clack from '@clack/prompts'
import { isCancel } from '@clack/prompts'
import { getModelOverrides, removeModelOverride, requireConfigPath } from './config.js'

/** Run the interactive "Remove model override" flow. */
export async function removeOverrideCommand(): Promise<void> {
  clack.intro('Remove Model Override')

  const configPath = requireConfigPath()
  const overrides = getModelOverrides(configPath)
  const keys = Object.keys(overrides)

  if (keys.length === 0) {
    clack.log.warn('No model overrides found.')
    clack.outro('')
    return
  }

  const selected = await clack.multiselect({
    message: 'Select overrides to remove',
    options: keys.map(k => ({
      value: k,
      label: k,
    })),
    required: true,
  })

  if (isCancel(selected)) return

  const toRemove = selected as string[]

  const confirmed = await clack.confirm({
    message: `Remove ${toRemove.length} override(s)?`,
  })

  if (isCancel(confirmed) || !confirmed) {
    clack.outro('Cancelled')
    return
  }

  for (const key of toRemove) {
    removeModelOverride(configPath, key)
  }

  clack.outro(`✓ ${toRemove.length} override(s) removed`)
}
