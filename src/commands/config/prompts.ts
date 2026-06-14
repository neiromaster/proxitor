import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { DEFAULTS } from '../../config.js';
import type { AuthType, TriState } from '../../config-schema.js';

export function maskKey(key: string): string {
  if (!key) return '(none)';
  if (key.length <= 11) return '****';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export async function askApiKey(currentKey: string): Promise<string | null> {
  if (currentKey) {
    clack.log.info(`Current key: ${maskKey(currentKey)}`);
  }
  const apiKey = await clack.text({
    message: 'OpenRouter API key',
    placeholder: currentKey ? 'Press Enter to keep current key' : 'sk-or-v1-...',
    validate: v => {
      if (!v?.trim() && !currentKey) return 'API key is required';
      return undefined;
    },
  });
  if (isCancel(apiKey)) return null;

  clack.note(
    'You can also set the OPENROUTER_API_KEY environment variable\nto avoid storing the key in the config file.',
    'Tip',
  );

  const value = (apiKey as string).trim();
  return value || currentKey;
}

export async function askPort(current: number): Promise<number | null> {
  const input = await clack.text({
    message: 'Proxy port',
    initialValue: String(current),
    placeholder: String(DEFAULTS.port),
    validate: v => {
      if (!v?.trim()) return undefined;
      const n = Number.parseInt(v, 10);
      if (Number.isNaN(n) || n < 1 || n > 65535) return 'Port must be 1–65535';
      return undefined;
    },
  });
  if (isCancel(input)) return null;
  return (input as string).trim() ? Number.parseInt(input as string, 10) : DEFAULTS.port;
}

export async function askBaseUrl(current: string): Promise<string | null> {
  const url = await clack.text({
    message: 'OpenRouter API base URL',
    placeholder: DEFAULTS.openrouterBaseUrl,
    initialValue: current === DEFAULTS.openrouterBaseUrl ? '' : current,
    validate: v => {
      if (!v?.trim()) return undefined;
      try {
        const parsed = new URL(v.trim());
        if (!parsed.protocol.startsWith('http'))
          return 'URL must start with http:// or https://';
      } catch {
        return 'Invalid URL';
      }
      return undefined;
    },
  });
  if (isCancel(url)) return null;
  return (url as string).trim() || DEFAULTS.openrouterBaseUrl;
}

export const AUTH_OPTIONS: Array<{ value: AuthType; label: string; hint: string }> = [
  { value: 'bearer', label: 'Bearer token', hint: 'Standard OpenRouter' },
  { value: 'oauth', label: 'OAuth token', hint: 'Custom proxy providers' },
];

export async function askAuthType(current: string): Promise<string | null> {
  const authType = await clack.select({
    message: 'Authentication type',
    initialValue: current,
    options: AUTH_OPTIONS,
  });
  if (isCancel(authType)) return null;
  return authType as string;
}

export async function askHost(current: string): Promise<string | null> {
  const isPreset = (v: string) => v === '0.0.0.0' || v === '127.0.0.1';
  const host = await clack.select({
    message: 'Listen address',
    initialValue: isPreset(current) ? (current as '0.0.0.0' | '127.0.0.1') : '__custom__',
    options: [
      { value: '0.0.0.0', label: 'All interfaces (0.0.0.0)', hint: 'Default' },
      { value: '127.0.0.1', label: 'Localhost only (127.0.0.1)', hint: 'More secure' },
      {
        value: '__custom__',
        label: 'Custom address…',
        hint: 'Specific IP, hostname, or unix:/path',
      },
    ],
  });
  if (isCancel(host)) return null;
  if (host === '__custom__') {
    const custom = await clack.text({
      message: 'Custom listen address',
      placeholder: '192.168.1.1',
      initialValue: isPreset(current) ? '' : current,
      validate: v => {
        const t = v?.trim();
        if (!t) return 'Address is required';
        if (t.startsWith('unix:')) return undefined;
        if (!/^[\w.\-:]+$/.test(t))
          return 'Invalid host (allowed: IP, hostname, or unix:…)';
        return undefined;
      },
    });
    if (isCancel(custom)) return null;
    return (custom as string).trim();
  }
  return host as string;
}

/** Shared hint texts for session routing tri-state — used in add, edit, session-routing. */
export const SESSION_HINTS: Record<TriState, string> = {
  auto: 'Passthrough client ID, generate if missing',
  always: 'Always generate proxy session ID',
  skip: 'Passthrough — leave client session headers as-is',
};

/** Shared hint texts for cache control tri-state — used in add, edit, cache-control. */
export const CACHE_HINTS: Record<TriState, string> = {
  auto: 'Anthropic models only',
  always: 'All models',
  skip: 'Passthrough — leave client cache_control headers as-is',
};

export async function askTriState(
  message: string,
  current: TriState | undefined,
  hints: Record<TriState, string>,
  opts?: { removable?: boolean },
): Promise<TriState | 'reset' | symbol> {
  const options: { value: TriState | 'reset'; label: string; hint: string }[] = [
    { value: 'auto', label: 'auto', hint: hints.auto },
    { value: 'always', label: 'always', hint: hints.always },
    { value: 'skip', label: 'skip', hint: hints.skip },
  ];
  if (opts?.removable) {
    options.push({
      value: 'reset',
      label: 'Reset / inherit',
      hint: 'Remove override',
    });
  }
  const result = await clack.select({
    message,
    initialValue: current ?? 'auto',
    options,
  });
  return result as TriState | 'reset' | symbol; // symbol = clack cancel
}

export async function askCacheControlTtl(
  current: '5m' | '1h' | 'omit' | 'skip' | undefined,
  opts?: {
    removable?: boolean;
    globalTtl?: '5m' | '1h' | 'omit' | 'skip' | undefined;
  },
): Promise<'5m' | '1h' | 'omit' | 'skip' | 'reset' | symbol> {
  const inherit =
    opts?.globalTtl === undefined
      ? 'inherit global (none)'
      : `inherit global (${opts.globalTtl})`;
  const overrides =
    opts?.globalTtl === undefined
      ? 'overrides inherited'
      : `overrides global ${opts.globalTtl}`;

  const options: { value: string; label: string; hint: string }[] = [
    { value: '5m', label: '5 minutes', hint: 'Anthropic default' },
    { value: '1h', label: '1 hour', hint: 'Higher write cost' },
    {
      value: 'skip',
      label: 'Passthrough',
      hint: `Preserve client ttl, ${overrides}`,
    },
    {
      value: 'omit',
      label: 'Strip',
      hint: `Guarantee no ttl (${overrides})`,
    },
  ];
  if (opts?.removable) {
    options.push({ value: 'reset', label: 'Reset / inherit', hint: inherit });
  }

  const result = await clack.select({
    message: 'Cache TTL',
    initialValue: current ?? '5m',
    options,
  });
  return result as '5m' | '1h' | 'omit' | 'skip' | 'reset' | symbol;
}
