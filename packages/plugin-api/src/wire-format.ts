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
