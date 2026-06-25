// src/proxy/observability/types.ts
export type CacheLabel = 'HIT' | 'PARTIAL' | 'MISS' | 'COLD' | 'NOUSAGE';
export type RequestType = 'main' | 'side';

export type ExtractedUsage = {
  cacheCreate: number;
  cacheRead: number;
  inputTokens: number;
  /** false when no usage object was seen at all (non-logged content type, etc.). */
  present: boolean;
};

export type RoutingMetadata = {
  attempt: number;
  fallback: boolean;
  generationId?: string;
  provider: string;
  region?: string;
  strategy: string;
};

export type CacheOutcome = {
  hitPct: number;
  label: CacheLabel;
  type: RequestType;
};

/** The single per-request record every sink consumes. */
export type CacheObservation = {
  model: string;
  outcome: CacheOutcome;
  reqId: string;
  requestType: RequestType;
  routing?: RoutingMetadata;
  sessionId?: string;
  status: number;
  toolsCount: number;
  usage: ExtractedUsage;
};

/** Request-side context threaded from the proxy into the response pipeline. */
export type RequestContext = {
  maxTokens?: number;
  model: string;
  reqId: string;
  requestType: RequestType;
  sessionId?: string;
  toolsCount: number;
};

export type Extracted = {
  routing?: RoutingMetadata;
  usage?: ExtractedUsage;
};
