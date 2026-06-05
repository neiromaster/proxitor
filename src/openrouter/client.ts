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
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly authType: AuthType | undefined

  constructor(apiKey: string, baseUrl: string, authType: AuthType)
  /** Create an unauthenticated client for public endpoints (e.g. OpenRouter data endpoints). */
  constructor(baseUrl: string)
  constructor(apiKeyOrUrl: string, baseUrl?: string, authType?: AuthType) {
    if (baseUrl !== undefined) {
      this.apiKey = apiKeyOrUrl
      this.baseUrl = baseUrl
      this.authType = authType
    } else {
      this.apiKey = undefined
      this.baseUrl = apiKeyOrUrl
      this.authType = undefined
    }
  }

  async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {}
    if (this.apiKey !== undefined && this.authType !== undefined) {
      headers.Authorization = formatAuthHeader(this.apiKey, this.authType)
    }

    const res = await fetch(url, { headers })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new OpenRouterClientError(res.status, body || res.statusText)
    }

    return res.json() as Promise<T>
  }
}
