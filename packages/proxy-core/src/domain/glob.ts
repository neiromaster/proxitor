/**
 * Glob matcher for model bindings (spec §5.2, decision D5): `*` is the only
 * wildcard and matches any sequence including the empty one; every other
 * character is literal; matching is case-insensitive.
 *
 * `compileGlob` builds the RegExp once (spec §14: no per-resolve compilation);
 * routing tables precompile one matcher per binding at build time.
 */
export function compileGlob(pattern: string): (value: string) => boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
  return value => regex.test(value);
}

export function globMatch(pattern: string, value: string): boolean {
  return compileGlob(pattern)(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
