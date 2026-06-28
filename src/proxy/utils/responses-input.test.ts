import { describe, expect, it } from 'vitest';
import { normalizeResponsesInput, shouldNormalizeResponses } from './responses-input.js';

// ---------------------------------------------------------------------------
// shouldNormalizeResponses
// ---------------------------------------------------------------------------

describe('shouldNormalizeResponses', () => {
  it('returns false when disabled, regardless of path', () => {
    expect(shouldNormalizeResponses(false, '/v1/responses')).toBe(false);
    expect(shouldNormalizeResponses(false, '/v1/chat/completions')).toBe(false);
  });

  it('returns true only on /v1/responses when enabled', () => {
    expect(shouldNormalizeResponses(true, '/v1/responses')).toBe(true);
    expect(shouldNormalizeResponses(true, '/v1/chat/completions')).toBe(false);
    expect(shouldNormalizeResponses(true, '/v1/messages')).toBe(false);
  });

  it('ignores a query string when classifying the path', () => {
    expect(shouldNormalizeResponses(true, '/v1/responses?foo=bar')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeResponsesInput
// ---------------------------------------------------------------------------

describe('normalizeResponsesInput', () => {
  it('tags role-bearing input items that lack type as type:"message"', () => {
    const body: Record<string, unknown> = {
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      ],
    };
    expect(normalizeResponsesInput(body)).toBe(true);
    const items = body.input as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ type: 'message', role: 'user' });
    expect(items[1]).toMatchObject({ type: 'message', role: 'assistant' });
  });

  it('synthesizes id and status for assistant history items', () => {
    const body: Record<string, unknown> = {
      input: [{ role: 'assistant', content: 'ok' }],
    };
    normalizeResponsesInput(body);
    const m = (body.input as Record<string, unknown>[])[0]!;
    expect(m.id).toMatch(/^msg_/);
    expect(m.status).toBe('completed');
  });

  it('moves role:system items into top-level instructions and drops them', () => {
    const body: Record<string, unknown> = {
      input: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hi' },
      ],
    };
    expect(normalizeResponsesInput(body)).toBe(true);
    expect(body.instructions).toBe('be helpful');
    const items = body.input as { role?: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('user');
  });

  it('concatenates an existing instructions string with a relocated system item', () => {
    const body: Record<string, unknown> = {
      instructions: 'base',
      input: [{ role: 'system', content: 'extra' }],
    };
    normalizeResponsesInput(body);
    expect(body.instructions).toBe('base\n\nextra');
  });

  it('extracts text from a system content-block array', () => {
    const body: Record<string, unknown> = {
      input: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'a' },
            { type: 'input_text', text: 'b' },
          ],
        },
      ],
    };
    normalizeResponsesInput(body);
    expect(body.instructions).toBe('a\nb');
  });

  it('leaves typed items (function_call, function_call_output) untouched', () => {
    const fc = { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' };
    const fco = { type: 'function_call_output', call_id: 'c1', output: 'r' };
    const body: Record<string, unknown> = { input: [fc, fco] };
    expect(normalizeResponsesInput(body)).toBe(false);
    const items = body.input as unknown[];
    expect(items[0]).toBe(fc);
    expect(items[1]).toBe(fco);
  });

  it('is idempotent — a second run reports no mutation', () => {
    const body: Record<string, unknown> = {
      input: [
        { role: 'system', content: 's' },
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'y' },
      ],
    };
    expect(normalizeResponsesInput(body)).toBe(true);
    expect(normalizeResponsesInput(body)).toBe(false);
  });

  it('returns false for string input or missing input', () => {
    expect(normalizeResponsesInput({ input: 'hello' })).toBe(false);
    expect(normalizeResponsesInput({})).toBe(false);
  });

  it('drops role:system items whose content has no extractable text (no role:system left in input)', () => {
    // OpenRouter has no system role in input; an image-only/empty system item
    // can't move to string `instructions`, so drop it — never keep role:"system".
    const body: Record<string, unknown> = {
      input: [
        {
          role: 'system',
          content: [{ type: 'input_image', image_url: 'https://x/y.png' }],
        },
        { role: 'user', content: 'hi' },
      ],
    };
    expect(normalizeResponsesInput(body)).toBe(true);
    const items = body.input as { role?: string }[];
    expect(items.some(i => i.role === 'system')).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]?.role).toBe('user');
  });

  it('matches the real failing dump shape (system + untyped messages + assistant w/o id/status)', () => {
    // Shape from dump 86a0da2b: the client body openrouter rejected with
    // invalid_prompt (discriminated-union validation on input[].type).
    const body: Record<string, unknown> = {
      model: 'anthropic/claude-sonnet-4.6',
      input: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: [{ type: 'input_text', text: 'do the thing' }] },
        { role: 'assistant', content: 'working' },
        { type: 'function_call', call_id: 'toolu_x', name: 'read', arguments: '{}' },
        { type: 'function_call_output', call_id: 'toolu_x', output: 'data' },
        { role: 'user', content: [{ type: 'input_text', text: 'thanks' }] },
      ],
    };
    expect(normalizeResponsesInput(body)).toBe(true);
    expect(body.instructions).toBe('system prompt');
    const items = body.input as Record<string, unknown>[];
    expect(items).toHaveLength(5);
    for (const item of items) {
      if (typeof item.role === 'string') expect(item.type).toBe('message');
    }
    const asst = items.find(i => i.role === 'assistant');
    expect(asst?.id).toMatch(/^msg_/);
    expect(asst?.status).toBe('completed');
    expect(items.some(i => i.type === 'function_call')).toBe(true);
    expect(items.some(i => i.type === 'function_call_output')).toBe(true);
  });
});
