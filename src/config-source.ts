import { buildProviderRouting, type ProxyConfig } from './config.js';

function fmt(value: unknown): string {
  if (value === undefined) return 'unset';
  if (value === true) return 'on';
  if (value === false) return 'off';
  return String(value);
}

const SCALAR_KEYS = [
  'cacheControl',
  'cacheControlTtl',
  'sessionId',
  'normalizeVolatileSystem',
  'authType',
  'verbose',
  'bodyLimit',
  'openrouterBaseUrl',
] as const;

function canonicalEntries(record: Record<string, unknown> | undefined): string {
  if (!record) return '';
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map(key => [key, record[key]]),
  );
}

/** Returns a human-readable diff of cache-relevant fields, or '' if nothing material changed. */
export function summarizeChanges(prev: ProxyConfig, next: ProxyConfig): string {
  const parts: string[] = [];

  for (const key of SCALAR_KEYS) {
    if (prev[key] !== next[key]) {
      parts.push(`${key}: ${fmt(prev[key])}→${fmt(next[key])}`);
    }
  }

  const prevRouting = JSON.stringify(buildProviderRouting(prev.provider));
  const nextRouting = JSON.stringify(buildProviderRouting(next.provider));
  if (prevRouting !== nextRouting) parts.push('provider routing');

  if (canonicalEntries(prev.modelOverrides) !== canonicalEntries(next.modelOverrides)) {
    const prevCount = prev.modelOverrides ? Object.keys(prev.modelOverrides).length : 0;
    const nextCount = next.modelOverrides ? Object.keys(next.modelOverrides).length : 0;
    parts.push(`modelOverrides: ${prevCount}→${nextCount}`);
  }

  if (canonicalEntries(prev.headers) !== canonicalEntries(next.headers)) {
    parts.push('headers');
  }

  return parts.join(', ');
}
