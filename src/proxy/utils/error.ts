/** OpenRouter error: { error: { code, message, metadata: { raw, provider_name } } } */
function formatMetadata(meta: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (meta.provider_name) parts.push(`provider=${meta.provider_name}`);
  if (meta.raw) {
    const raw = typeof meta.raw === 'string' ? meta.raw : JSON.stringify(meta.raw);
    parts.push(raw);
  }
  return parts;
}

export function extractErrorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) return bodyText;

    const err = parsed.error;
    if (typeof err === 'object' && err !== null && err.message) {
      const parts: string[] = [];
      if (err.code != null) parts.push(String(err.code));
      parts.push(String(err.message));
      if (err.metadata && typeof err.metadata === 'object') {
        parts.push(...formatMetadata(err.metadata as Record<string, unknown>));
      }
      return parts.join(' | ');
    }
    if (parsed.message) return String(parsed.message);
  } catch {
    // not JSON
  }
  return bodyText;
}
