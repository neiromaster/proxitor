export function isAnthropicModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return (
    lower.startsWith('anthropic/claude') ||
    lower.startsWith('claude-') ||
    lower.includes('claude')
  );
}
