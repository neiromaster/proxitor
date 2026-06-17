import { DEFAULTS } from '../../config.js';
import type { ModelOverride, ProxyConfig } from '../../config-schema.js';

type TtlValue = '5m' | '1h' | 'omit' | 'skip' | undefined;

function ttlLabel(value: TtlValue): string {
  return value ?? '(default)';
}

function boolLabel(value: boolean | undefined, fallback: boolean): string {
  return (value ?? fallback) ? 'on' : 'off';
}

function nvsLabel(value: boolean | undefined, globalValue: boolean): string {
  if (value === undefined) {
    return `(inherit -> ${globalValue ? 'on' : 'off'})`;
  }
  return value ? 'on' : 'off';
}

export function formatGlobalCachingSummary(cfg: Partial<ProxyConfig>): string {
  const cc = cfg.cacheControl ?? DEFAULTS.cacheControl;
  const sid = cfg.sessionId ?? DEFAULTS.sessionId;
  const nvs = boolLabel(cfg.normalizeVolatileSystem, DEFAULTS.normalizeVolatileSystem);

  return [
    'Three settings shape the request so cache survives.',
    '',
    `  cacheControl            = ${cc}    (activate cache)`,
    `  cacheControlTtl         = ${ttlLabel(cfg.cacheControlTtl as TtlValue)}`,
    `  sessionId               = ${sid}    (pin provider)`,
    `  normalizeVolatileSystem = ${nvs}     (stable prefix)`,
    '',
    'Anthropic -> levers 1+2 - non-Anthropic (qwen/glm) -> all 3',
  ].join('\n');
}

export function formatPerModelCachingSummary(
  modelKey: string,
  current: ModelOverride,
  globalCfg: Partial<ProxyConfig>,
): string {
  const gCc = globalCfg.cacheControl ?? DEFAULTS.cacheControl;
  const gSid = globalCfg.sessionId ?? DEFAULTS.sessionId;
  const gNvs = globalCfg.normalizeVolatileSystem ?? DEFAULTS.normalizeVolatileSystem;

  const cc = current.cacheControl ?? `(inherit -> ${gCc})`;
  const ttl =
    current.cacheControlTtl ??
    (globalCfg.cacheControlTtl
      ? `(inherit -> ${globalCfg.cacheControlTtl})`
      : '(inherit)');
  const sid = current.sessionId ?? `(inherit -> ${gSid})`;
  const nvs = nvsLabel(current.normalizeVolatileSystem, gNvs);

  return [
    `Caching for "${modelKey}"`,
    '',
    `  cacheControl            = ${cc}`,
    `  cacheControlTtl         = ${ttl}`,
    `  sessionId               = ${sid}`,
    `  normalizeVolatileSystem = ${nvs}`,
  ].join('\n');
}
