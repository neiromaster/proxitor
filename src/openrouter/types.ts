/** Verified against the live API on 2026-06-04. */

type PercentileStats = {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p99: number | null;
};

type OpenRouterModelArchitecture = {
  input_modalities?: string[];
  instruct_type: string | null;
  modality: string;
  output_modalities?: string[];
  tokenizer: string | null;
};

type OpenRouterModelPricing = {
  completion: string;
  image?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  prompt: string;
  request?: string;
};

type OpenRouterModelTopProvider = {
  context_length: number;
  is_moderated: boolean;
  max_completion_tokens: number | null;
};

type OpenRouterModelLinks = {
  details?: string;
};

export type OpenRouterModel = {
  architecture: OpenRouterModelArchitecture;
  canonical_slug: string;
  context_length: number;
  created: number;
  default_parameters: Record<string, unknown>;
  description: string;
  expiration_date: string | null;
  hugging_face_id: string | null;
  id: string;
  knowledge_cutoff: string | null;
  links: OpenRouterModelLinks;
  name: string;
  per_request_limits: Record<string, unknown> | null;
  pricing: OpenRouterModelPricing;
  supported_parameters: string[];
  supported_voices: unknown[] | null;
  top_provider: OpenRouterModelTopProvider;
};

type ModelEndpointPricing = {
  completion: string;
  discount?: number;
  input_cache_read?: string;
  input_cache_write?: string;
  prompt: string;
  web_search?: string;
};

export type ModelEndpoint = {
  context_length: number;
  latency_last_30m: PercentileStats | null;
  max_completion_tokens: number | null;
  max_prompt_tokens: number | null;
  model_id: string;
  model_name: string;
  name: string;
  pricing: ModelEndpointPricing;
  provider_name: string;
  quantization: string;
  status: number;
  supported_parameters: string[];
  supports_implicit_caching: boolean;
  /** Routing slug for `provider.only/order/ignore` (e.g. "google-vertex/global", "anthropic"). */
  tag: string;
  throughput_last_30m: PercentileStats | null;
  uptime_last_1d: number | null;
  uptime_last_5m: number | null;
  uptime_last_30m: number | null;
};

export type OpenRouterProvider = {
  datacenters: string[] | null;
  headquarters: string | null;
  name: string;
  privacy_policy_url: string | null;
  slug: string;
  status_page_url: string | null;
  terms_of_service_url: string | null;
};
