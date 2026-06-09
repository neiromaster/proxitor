import { readFileSync, writeFileSync } from 'node:fs';
import type { YAMLMap } from 'yaml';
import { parseDocument } from 'yaml';
import { findConfigFile, tryFindConfigFile } from '../../config.js';
import type { ModelOverride } from '../../config-schema.js';
import { logger } from '../../logger.js';

/**
 * Throws {@link MissingConfigError} via `findConfigFile` if no config is found.
 * Kept as a named helper for symmetry with `getModelOverrides` / `setModelOverride`.
 */
export function requireConfigPath(): string {
  return findConfigFile();
}

export function readConfigRaw(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function writeConfigRaw(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

export function setModelOverride(
  configPath: string,
  modelKey: string,
  override: ModelOverride,
): void {
  const raw = readConfigRaw(configPath);
  const doc = parseDocument(raw);

  let overrides = doc.get('modelOverrides') as YAMLMap | undefined;
  if (!overrides) {
    overrides = doc.createNode({}) as YAMLMap;
    doc.set('modelOverrides', overrides);
  }

  overrides.set(modelKey, override);

  writeConfigRaw(configPath, doc.toString());
  logger.success(`Saved override for "${modelKey}"`);
}

export function removeModelOverride(configPath: string, modelKey: string): void {
  const raw = readConfigRaw(configPath);
  const doc = parseDocument(raw);

  const overrides = doc.get('modelOverrides') as YAMLMap | undefined;
  if (!overrides?.has(modelKey)) {
    throw new Error(`No override found for "${modelKey}"`);
  }

  overrides.delete(modelKey);
  if (overrides.items.length === 0) {
    doc.delete('modelOverrides');
  }

  writeConfigRaw(configPath, doc.toString());
  logger.success(`Removed override for "${modelKey}"`);
}

export function getModelOverrides(configPath: string): Record<string, ModelOverride> {
  const raw = readConfigRaw(configPath);
  const doc = parseDocument(raw);
  const overrides = doc.get('modelOverrides');
  if (!overrides) return {};
  if (typeof overrides === 'object' && overrides !== null && 'toJSON' in overrides) {
    return (overrides as { toJSON: () => unknown }).toJSON() as Record<
      string,
      ModelOverride
    >;
  }
  return overrides as unknown as Record<string, ModelOverride>;
}

export { tryFindConfigFile };
