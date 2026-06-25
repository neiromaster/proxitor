// src/proxy/observability/classify.ts
import type { CacheLabel, CacheOutcome, ExtractedUsage, RequestType } from './types.js';

export function classifyRequestType(
  ctx: { toolsCount: number; maxTokens?: number },
  opts: { sideMaxTokens: number },
): RequestType {
  // A missing OR non-positive budget (max_tokens: 0 / negative) carries no
  // meaningful side-call signal — treat it as unbounded so a degenerate main
  // turn isn't bucketed as [side]. Only a real positive small budget counts.
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
  // Clamp at 100: a non-standard provider that reports cached tokens excluded
  // from prompt_tokens can otherwise yield hitPct > 100 in logs and dumps.
  const raw = usage.inputTokens > 0 ? (usage.cacheRead / usage.inputTokens) * 100 : 0;
  const hitPct = Math.min(100, raw);
  let label: CacheLabel;
  if (usage.cacheRead === 0) label = ctx.isFirstForSession ? 'COLD' : 'MISS';
  else label = hitPct >= opts.hitThresholdPct ? 'HIT' : 'PARTIAL';
  return { label, type: ctx.requestType, hitPct: Number(hitPct.toFixed(1)) };
}
