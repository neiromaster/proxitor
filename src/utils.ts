/** Normalize a single string or array of strings to an array */
export function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? [...value] : [value]
}

/** Try to parse an ArrayBuffer as JSON. Returns undefined on failure or empty body. */
export function tryParseBody(raw: ArrayBuffer): Record<string, unknown> | undefined {
  if (raw.byteLength === 0) return undefined
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
  } catch {
    return undefined
  }
}
