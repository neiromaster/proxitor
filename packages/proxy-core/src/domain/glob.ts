/**
 * Glob matcher for model bindings (spec §5.2, decision D5): `*` is the only
 * wildcard and matches any sequence including the empty one; every other
 * character is literal; matching is case-insensitive.
 */
export function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return regex.test(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
