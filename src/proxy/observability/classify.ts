import type { CacheLabel, CacheOutcome, ExtractedUsage, RequestType } from './types.js';

export function classifyRequestType(
  ctx: { toolsCount: number; maxTokens?: number },
  opts: { sideMaxTokens: number },
): RequestType {
  // A missing or non-positive budget is unbounded: only a small positive one
  // signals a side call.
  const budget =
    ctx.maxTokens === undefined || ctx.maxTokens <= 0
      ? Number.POSITIVE_INFINITY
      : ctx.maxTokens;
  return ctx.toolsCount === 0 && budget <= opts.sideMaxTokens ? 'side' : 'main';
}

export function classifyCacheOutcome(
  usage: ExtractedUsage,
  ctx: { requestType: RequestType; isFirstForSession: boolean },
  opts: { hitThresholdPct: number },
): CacheOutcome {
  if (!usage.present) return { label: 'NOUSAGE', type: ctx.requestType, hitPct: 0 };
  // Clamp at 100: some providers report cacheRead > prompt_tokens.
  const raw = usage.inputTokens > 0 ? (usage.cacheRead / usage.inputTokens) * 100 : 0;
  const hitPct = Math.min(100, raw);
  let label: CacheLabel;
  if (usage.cacheRead === 0) label = ctx.isFirstForSession ? 'COLD' : 'MISS';
  else label = hitPct >= opts.hitThresholdPct ? 'HIT' : 'PARTIAL';
  return { label, type: ctx.requestType, hitPct: Number(hitPct.toFixed(1)) };
}
