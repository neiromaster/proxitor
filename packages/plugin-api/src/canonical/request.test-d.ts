import { describe, expectTypeOf, it } from 'vitest';
import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalRequest,
  MaxTokens,
} from './request.js';

describe('CanonicalRequest types (spec §4.1)', () => {
  it('content blocks discriminate by type', () => {
    type ToolUseBlock = Extract<CanonicalContentBlock, { type: 'tool_use' }>;
    type ToolResultBlock = Extract<CanonicalContentBlock, { type: 'tool_result' }>;
    type ThinkingBlock = Extract<CanonicalContentBlock, { type: 'thinking' }>;

    expectTypeOf<ToolUseBlock['id']>().toEqualTypeOf<string>();
    expectTypeOf<ToolUseBlock['name']>().toEqualTypeOf<string>();
    expectTypeOf<ToolUseBlock['input']>().toEqualTypeOf<unknown>();

    expectTypeOf<ToolResultBlock['toolUseId']>().toEqualTypeOf<string>();
    expectTypeOf<ToolResultBlock['content']>().toEqualTypeOf<
      CanonicalContentBlock[] | string
    >();

    expectTypeOf<ThinkingBlock['signature']>().toEqualTypeOf<string | undefined>();
  });

  it('maxTokens carries provenance (r2 P0-1)', () => {
    expectTypeOf<MaxTokens>().toEqualTypeOf<{
      value: number;
      source: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';
    }>();
  });

  it('every node carries optional passthrough extensions', () => {
    expectTypeOf<CanonicalMessage['extensions']>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >();
    expectTypeOf<CanonicalRequest['extensions']>().toEqualTypeOf<
      Record<string, Record<string, unknown>>
    >();
  });

  it('model is logical+physical, stream required, outboundHeaders optional', () => {
    expectTypeOf<CanonicalRequest['model']>().toEqualTypeOf<{
      logical: string;
      physical: string;
    }>();
    expectTypeOf<CanonicalRequest['stream']>().toEqualTypeOf<boolean>();
    expectTypeOf<CanonicalRequest['outboundHeaders']>().toEqualTypeOf<
      Record<string, string> | undefined
    >();
  });
});
