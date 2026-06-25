/** `"anthropic/claude-sonnet-4"` → `"anthropic"`; a bare `"gpt-4o"` → `"gpt-4o"`. */
export function parseModelAuthor(modelId: string): string {
  return modelId.split('/')[0] ?? '';
}

/** Text after the first `/`, or `""` for a bare id. `"openai/gpt-4o"` → `"gpt-4o"`. */
export function parseModelSlug(modelId: string): string {
  return modelId.split('/').slice(1).join('/');
}
