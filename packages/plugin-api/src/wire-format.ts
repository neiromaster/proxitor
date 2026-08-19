export const WIRE_FORMATS = ['anthropic-messages', 'openai-chat'] as const;

export type WireFormat = (typeof WIRE_FORMATS)[number];

/**
 * Format-reserved extension keys (spec §4.3): the only keys a plugin may write
 * into `ir.extensions[format]`. Public contract — keep in sync with README.
 */
export const RESERVED_KEYS: Readonly<Record<WireFormat, readonly string[]>> = {
  'anthropic-messages': [],
  'openai-chat': [
    '$proxitor.provider',
    '$proxitor.models',
    '$proxitor.route',
    '$proxitor.transforms',
  ],
};

/**
 * Endpoint path each wire format owns (spec §5.1): the format adapter owns the
 * version path; a provider `baseUrl` is everything before it. Consumed by
 * domain routing for baseUrl validation and upstream URL construction.
 */
export const ENDPOINT_PATHS: Readonly<Record<WireFormat, string>> = {
  'anthropic-messages': '/v1/messages',
  'openai-chat': '/v1/chat/completions',
};
