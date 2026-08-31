import type { CacheLabel, RequestType, UsageSnapshot } from './observability.js';

export function classifyRequestType(
  ctx: { toolsCount: number; maxTokens?: number },
  opts: { sideMaxTokens: number },
): RequestType {
  const budget =
    ctx.maxTokens === undefined || ctx.maxTokens <= 0
      ? Number.POSITIVE_INFINITY
      : ctx.maxTokens;
  return ctx.toolsCount === 0 && budget <= opts.sideMaxTokens ? 'side' : 'main';
}

export function classifyCacheOutcome(
  usage: UsageSnapshot,
  ctx: { requestType: RequestType; isFirstForSession: boolean },
  opts: { hitThresholdPct: number },
): { label: CacheLabel; type: RequestType; hitPct: number } {
  if (!usage.present) return { label: 'NOUSAGE', type: ctx.requestType, hitPct: 0 };
  const raw = usage.inputTokens > 0 ? (usage.cacheRead / usage.inputTokens) * 100 : 0;
  const hitPct = Math.min(100, raw);
  let label: CacheLabel;
  if (usage.cacheRead === 0) label = ctx.isFirstForSession ? 'COLD' : 'MISS';
  else label = hitPct >= opts.hitThresholdPct ? 'HIT' : 'PARTIAL';
  return { label, type: ctx.requestType, hitPct: Number(hitPct.toFixed(1)) };
}
