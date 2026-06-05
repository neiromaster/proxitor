import type { AuthType } from '../config-schema.js'
import { formatAuthHeader } from '../utils.js'

export class OpenRouterClientError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(`OpenRouter API error (${status}): ${message}`)
    this.name = 'OpenRouterClientError'
    this.status = status
  }
}

/** HTTP client for OpenRouter REST endpoints. */
export class OpenRouterClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly authType: AuthType

  constructor(apiKey: string, baseUrl: string, authType: AuthType) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.authType = authType
  }

  async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const res = await fetch(url, {
      headers: {
        Authorization: formatAuthHeader(this.apiKey, this.authType),
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new OpenRouterClientError(res.status, body || res.statusText)
    }

    return res.json() as Promise<T>
  }
}
