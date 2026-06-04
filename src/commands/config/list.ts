import * as clack from '@clack/prompts'
import type { ModelOverride } from '../../config-schema.js'
import { getModelOverrides, requireConfigPath } from './shared.js'

/** Display all current model overrides. */
export async function listOverridesCommand(): Promise<void> {
  const configPath = requireConfigPath()
  const overrides = getModelOverrides(configPath)
  const keys = Object.keys(overrides)

  if (keys.length === 0) {
    clack.log.info('No model overrides configured.')
    return
  }

  clack.log.success(`${keys.length} override(s) in ${configPath}`)

  for (const key of keys) {
    const override: ModelOverride | undefined = overrides[key]
    if (!override) continue
    const parts: string[] = []

    if (override.provider) {
      for (const [field, value] of Object.entries(override.provider)) {
        if (value !== undefined) parts.push(`${field}: ${JSON.stringify(value)}`)
      }
    }

    if (override.headers) {
      for (const [name, value] of Object.entries(override.headers)) {
        parts.push(`header ${name}: ${value}`)
      }
    }

    clack.log.info(`  ${key} — ${parts.join(', ') || '(empty)'}`)
  }
}
