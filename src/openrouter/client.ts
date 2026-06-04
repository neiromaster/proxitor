const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

export class OpenRouterClientError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(`OpenRouter API error (${status}): ${message}`)
    this.name = 'OpenRouterClientError'
    this.status = status
  }
}

/** HTTP client for OpenRouter REST endpoints. Auth header is only sent when apiKey is non-empty. */
export class OpenRouterClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL
  }

  async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const res = await fetch(url, {
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new OpenRouterClientError(res.status, body || res.statusText)
    }

    return res.json() as Promise<T>
  }
}
