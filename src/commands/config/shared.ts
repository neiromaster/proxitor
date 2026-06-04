import { readFileSync, writeFileSync } from 'node:fs'
import type { YAMLMap } from 'yaml'
import { parseDocument } from 'yaml'
import { findConfigFile } from '../../config.js'
import type { ModelOverride } from '../../config-schema.js'
import { logger } from '../../logger.js'

export function requireConfigPath(): string {
  const path = findConfigFile()
  if (!path) {
    throw new Error(
      'No config file found. Create proxitor.config.yaml first, or pass -c <path>.',
    )
  }
  return path
}

export function readConfigRaw(path: string): string {
  return readFileSync(path, 'utf-8')
}

export function writeConfigRaw(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8')
}

/** Add or update a model override, preserving YAML comments. */
export function setModelOverride(
  configPath: string,
  modelKey: string,
  override: ModelOverride,
): void {
  const raw = readConfigRaw(configPath)
  const doc = parseDocument(raw)

  let overrides = doc.get('modelOverrides') as YAMLMap | undefined
  if (!overrides) {
    overrides = doc.createNode({}) as YAMLMap
    doc.set('modelOverrides', overrides)
  }

  overrides.set(modelKey, override)

  writeConfigRaw(configPath, doc.toString())
  logger.success(`Saved override for "${modelKey}"`)
}

export function removeModelOverride(configPath: string, modelKey: string): void {
  const raw = readConfigRaw(configPath)
  const doc = parseDocument(raw)

  const overrides = doc.get('modelOverrides') as YAMLMap | undefined
  if (!overrides?.has(modelKey)) {
    throw new Error(`No override found for "${modelKey}"`)
  }

  overrides.delete(modelKey)
  if (overrides.items.length === 0) {
    doc.delete('modelOverrides')
  }

  writeConfigRaw(configPath, doc.toString())
  logger.success(`Removed override for "${modelKey}"`)
}

export function getModelOverrides(configPath: string): Record<string, ModelOverride> {
  const raw = readConfigRaw(configPath)
  const doc = parseDocument(raw)
  const overrides = doc.get('modelOverrides')
  if (!overrides) return {}
  if (typeof overrides === 'object' && overrides !== null && 'toJSON' in overrides) {
    return (overrides as { toJSON: () => unknown }).toJSON() as Record<
      string,
      ModelOverride
    >
  }
  return overrides as unknown as Record<string, ModelOverride>
}

export function formatPricing(prompt: string, completion: string): string {
  const fmt = (perToken: string) => {
    const per1M = Number.parseFloat(perToken) * 1_000_000
    if (per1M === 0) return 'free'
    if (per1M < 0.01) return `$${per1M.toFixed(4)}`
    return `$${per1M.toFixed(2)}`
  }
  return `${fmt(prompt)} / ${fmt(completion)} per 1M tokens`
}

/** `200000` → `"200k"`, `1000000` → `"1.0M"` */
export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return `${tokens}`
}

/** `1137` → `"1.1s"`, `null` → `"N/A"` */
export function formatLatency(ms: number | null): string {
  if (ms === null) return 'N/A'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatThroughput(tokensPerSec: number | null): string {
  if (tokensPerSec === null) return 'N/A'
  return `${tokensPerSec.toFixed(0)} t/s`
}
