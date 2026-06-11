import { readFileSync, writeFileSync } from 'node:fs';
import type { YAMLMap } from 'yaml';
import { parseDocument } from 'yaml';
import { findConfigFile, tryFindConfigFile } from '../../config.js';
import type { ModelOverride, ProxyConfig } from '../../config-schema.js';
import { logger } from '../../logger.js';

/**
 * Throws {@link MissingConfigError} via `findConfigFile` if no config is found.
 * Pass an explicit path to skip discovery and use that file directly.
 */
export function requireConfigPath(explicitPath?: string): string {
  return findConfigFile(explicitPath);
}

export function readConfigRaw(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function writeConfigRaw(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

export function setGlobalConfigField(
  configPath: string,
  field: keyof ProxyConfig,
  value: unknown,
): void {
  const raw = readConfigRaw(configPath);
  const doc = parseDocument(raw);

  if (value === undefined) {
    doc.delete(field);
  } else {
    doc.set(field, value);
  }

  writeConfigRaw(configPath, doc.toString());
}

/**
 * Atomic batch write — updates multiple fields in a single read-parse-write
 * cycle, eliminating the risk of partial state on crash or Ctrl-C.
 */
export function setGlobalConfigFields(
  configPath: string,
  fields: Record<string, unknown>,
): void {
  const raw = readConfigRaw(configPath);
  const doc = parseDocument(raw);

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      doc.delete(key);
    } else {
      doc.set(key, value);
    }
  }

  writeConfigRaw(configPath, doc.toString());
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
