import { DEFAULTS } from '../../config.js';
import type { ModelOverride, ProxyConfig, TriState } from '../../config-schema.js';

type TtlValue = '5m' | '1h' | 'omit' | 'skip' | undefined;

/** Friendly TTL label (omit→strip, skip→passthrough). */
export function describeTtl(value: TtlValue): string {
  if (value === undefined) return '(default)';
  if (value === 'omit') return 'strip';
  if (value === 'skip') return 'passthrough';
  return value;
}

/** Global NVS: distinguish absent (default-origin) from an explicit on/off. */
function globalNvsLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return `(default -> ${DEFAULTS.normalizeVolatileSystem ? 'on' : 'off'})`;
  }
  return value ? 'on' : 'off';
}

/** Global tri-state: distinguish absent (default-origin) from an explicit mode. */
function globalTriStateLabel(value: TriState | undefined, fallback: TriState): string {
  return value === undefined ? `(default -> ${fallback})` : value;
}

function nvsLabel(value: boolean | undefined, globalValue: boolean): string {
  if (value === undefined) {
    return `(inherit -> ${globalValue ? 'on' : 'off'})`;
  }
  return value ? 'on' : 'off';
}

function perModelTtl(current: ModelOverride, globalCfg: Partial<ProxyConfig>): string {
  if (current.cacheControlTtl !== undefined) return describeTtl(current.cacheControlTtl);
  if (globalCfg.cacheControlTtl !== undefined) {
    return `(inherit -> ${describeTtl(globalCfg.cacheControlTtl as TtlValue)})`;
  }
  return '(inherit)';
}

export function formatGlobalCachingSummary(cfg: Partial<ProxyConfig>): string {
  const cc = globalTriStateLabel(cfg.cacheControl, DEFAULTS.cacheControl);
  const rewrite = globalTriStateLabel(cfg.rewriteBlockTtl, DEFAULTS.rewriteBlockTtl);
  const sid = globalTriStateLabel(cfg.sessionId, DEFAULTS.sessionId);
  const nvs = globalNvsLabel(cfg.normalizeVolatileSystem);

  return [
    'Three settings shape the request so cache survives.',
    '',
    `  cacheControl            = ${cc}    (activate cache)`,
    `  cacheControlTtl         = ${describeTtl(cfg.cacheControlTtl as TtlValue)}`,
    `  rewriteBlockTtl         = ${rewrite}    (normalize block ttl)`,
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
  const gRewrite = globalCfg.rewriteBlockTtl ?? DEFAULTS.rewriteBlockTtl;
  const gSid = globalCfg.sessionId ?? DEFAULTS.sessionId;
  const gNvs = globalCfg.normalizeVolatileSystem ?? DEFAULTS.normalizeVolatileSystem;

  const cc = current.cacheControl ?? `(inherit -> ${gCc})`;
  const ttl = perModelTtl(current, globalCfg);
  const rewrite = current.rewriteBlockTtl ?? `(inherit -> ${gRewrite})`;
  const sid = current.sessionId ?? `(inherit -> ${gSid})`;
  const nvs = nvsLabel(current.normalizeVolatileSystem, gNvs);

  return [
    `Caching for "${modelKey}"`,
    '',
    `  cacheControl            = ${cc}`,
    `  cacheControlTtl         = ${ttl}`,
    `  rewriteBlockTtl         = ${rewrite}`,
    `  sessionId               = ${sid}`,
    `  normalizeVolatileSystem = ${nvs}`,
  ].join('\n');
}
