/** Inject provider routing into request body, always overwriting existing value */
export function injectProvider(
  rawBody: ArrayBuffer,
  providerRouting: Record<string, unknown>,
): ArrayBuffer {
  const text = rawBody.byteLength > 0 ? new TextDecoder().decode(rawBody) : '{}'

  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch (parseError) {
    const err = new Error('Request body is not valid JSON; cannot inject provider', {
      cause: parseError,
    })
    throw err
  }

  const modified = { ...json, provider: providerRouting }
  return new TextEncoder().encode(JSON.stringify(modified)).buffer as ArrayBuffer
}
