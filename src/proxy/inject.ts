export type InjectionParams = {
  providerRouting?: Record<string, unknown>;
  cacheControl?: boolean;
  sessionId?: string;
};

export function isAnthropicModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return (
    lower.startsWith('anthropic/claude') ||
    lower.startsWith('claude-') ||
    lower.includes('claude')
  );
}

export function extractModel(rawBody: ArrayBuffer): string | undefined {
  try {
    const json = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;
    return typeof json?.model === 'string' ? json.model : undefined;
  } catch {
    return undefined;
  }
}
