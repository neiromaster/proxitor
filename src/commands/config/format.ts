import { formatPrice } from '../../openrouter/models.js'
import type { OpenRouterModel } from '../../openrouter/types.js'

export function formatPricing(prompt: string, completion: string): string {
  const fmt = (perToken: string) => {
    const per1M = Number.parseFloat(perToken) * 1_000_000
    if (per1M === 0) return 'free'
    if (per1M < 0.01) return `$${per1M.toFixed(4)}`
    return `$${per1M.toFixed(2)}`
  }
  return `${fmt(prompt)} / ${fmt(completion)}`
}

/** `200000` → `"200k"`, `1000000` → `"1.0M"` */
export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return `${tokens}`
}

/** `1137` → `"1.1s"`, `null` → `"N/A"` */
export function formatLatency(ms: number | null): string {
  if (ms === null) return 'N/A'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatThroughput(tokensPerSec: number | null): string {
  if (tokensPerSec === null) return 'N/A'
  return `${tokensPerSec.toFixed(0)} t/s`
}

export function formatModelLabel(m: OpenRouterModel): string {
  return `${m.name || m.id}  —  ${formatPrice(m.pricing.prompt)} · ${formatContextLength(m.context_length)}`
}

export function formatModelHint(m: OpenRouterModel): string {
  const parts = [`out ${formatPrice(m.pricing.completion)}`]
  if (m.pricing.input_cache_read && m.pricing.input_cache_read !== '0') {
    parts.push(`cache ${formatPrice(m.pricing.input_cache_read)}`)
  }
  return parts.join(' · ')
}
