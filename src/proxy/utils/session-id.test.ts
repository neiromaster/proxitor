import { describe, expect, it } from 'vitest';
import { deriveSessionId, extractConversationFingerprint } from './session-id.js';

describe('extractConversationFingerprint', () => {
  it('extracts system + user from chat-completions (default) endpoint', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    };

    const fp = extractConversationFingerprint(body, '/v1/chat/completions');
    expect(fp).toBeTypeOf('string');
    expect(fp!.length).toBe(64); // SHA-256 hex
  });

  it('uses developer role as system for chat-completions', () => {
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'developer', content: 'System prompt' },
        { role: 'user', content: 'Question' },
      ],
    };

    const fp = extractConversationFingerprint(body, '/v1/chat/completions');
    expect(fp).not.toBeNull();
  });

  it('extracts instructions + input from responses endpoint', () => {
    const body = {
      model: 'gpt-4o',
      instructions: 'You are a coding assistant.',
      input: 'Write a function',
    };

    const fp = extractConversationFingerprint(body, '/v1/responses');
    expect(fp).not.toBeNull();
    expect(fp!.length).toBe(64);
  });

  it('extracts system + first user message from messages endpoint', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: 'Follow-up' },
      ],
    };

    const fp = extractConversationFingerprint(body, '/v1/messages');
    expect(fp).not.toBeNull();
    // Uses the first user message, not the follow-up
    expect(fp).toBe(
      extractConversationFingerprint(
        {
          model: 'claude-sonnet-4-6',
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'First question' }],
        },
        '/v1/messages',
      ),
    );
  });

  it('returns null when no system or user content', () => {
    expect(extractConversationFingerprint({}, '/v1/chat/completions')).toBeNull();
    expect(
      extractConversationFingerprint({ model: 'gpt-4o' }, '/v1/chat/completions'),
    ).toBeNull();
    expect(
      extractConversationFingerprint({ messages: [] }, '/v1/chat/completions'),
    ).toBeNull();
  });

  it('returns fingerprint with only system content (no user)', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'system', content: 'You are helpful.' }],
    };

    expect(extractConversationFingerprint(body, '/v1/chat/completions')).not.toBeNull();
  });

  it('returns fingerprint with only user content (no system)', () => {
    const body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    expect(extractConversationFingerprint(body, '/v1/chat/completions')).not.toBeNull();
  });

  it('classifies unknown paths as "other" (chat-completions default)', () => {
    const body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const fp = extractConversationFingerprint(body, '/v1/unknown');
    expect(fp).not.toBeNull();
  });

  it('is deterministic — same input produces same fingerprint', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const a = extractConversationFingerprint(body, '/v1/chat/completions');
    const b = extractConversationFingerprint(body, '/v1/chat/completions');
    expect(a).toBe(b);
  });

  it('falls back gracefully when system content is non-serializable', () => {
    // Circular system ref is skipped; fingerprint from user content only.
    const circular: Record<string, unknown> = { role: 'system' };
    circular.self = circular;

    const body = {
      model: 'claude-sonnet-4-6',
      system: circular,
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const fp = extractConversationFingerprint(body, '/v1/messages');
    expect(fp).toBeTypeOf('string');
    expect(fp!.length).toBe(64);
  });
});

describe('deriveSessionId', () => {
  const mockHeaders = (headers: Record<string, string> = {}): Headers => {
    return new Headers(headers);
  };

  it('returns undefined when mode is "never"', () => {
    const headers = mockHeaders({ 'x-claude-code-session-id': 'abc123' });
    expect(
      deriveSessionId(headers, { session_id: 'xyz' }, '/v1/chat/completions', 'never'),
    ).toBeUndefined();
  });

  it('in "auto" mode, passes through x-claude-code-session-id header', () => {
    const headers = mockHeaders({ 'x-claude-code-session-id': 'abc123' });
    const result = deriveSessionId(
      headers,
      { session_id: 'from-body' },
      '/v1/responses',
      'auto',
    );
    expect(result).toBe('abc123');
  });

  it('in "always" mode, ignores x-claude-code-session-id header', () => {
    const headers = mockHeaders({ 'x-claude-code-session-id': 'abc123' });
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = deriveSessionId(headers, body, '/v1/chat/completions', 'always');
    expect(result).not.toBe('abc123');
    expect(result!.length).toBe(64);
  });

  it('in "auto" mode, uses session_id from body when no header', () => {
    const headers = mockHeaders();
    const result = deriveSessionId(
      headers,
      { session_id: 'from-body' },
      '/v1/responses',
      'auto',
    );
    expect(result).toBe('from-body');
  });

  it('in "always" mode, ignores session_id from body', () => {
    const headers = mockHeaders();
    const body = {
      model: 'claude-sonnet-4-6',
      session_id: 'from-body',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = deriveSessionId(headers, body, '/v1/chat/completions', 'always');
    expect(result).not.toBe('from-body');
    expect(result!.length).toBe(64);
  });

  it('ignores empty string session_id from body', () => {
    const headers = mockHeaders();
    const body = {
      model: 'gpt-4o',
      session_id: '',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const result = deriveSessionId(headers, body, '/v1/chat/completions', 'auto');
    // Falls through to content fingerprint
    expect(result).toBeTypeOf('string');
    expect(result).not.toBe('');
  });

  it('falls back to content fingerprint when no header or body session_id', () => {
    const headers = mockHeaders();
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const result = deriveSessionId(headers, body, '/v1/chat/completions', 'auto');
    expect(result).toBeTypeOf('string');
    expect(result!.length).toBe(64); // SHA-256 hex
  });

  it('falls back to proxy UUID when no content available', () => {
    const headers = mockHeaders();
    const result = deriveSessionId(headers, undefined, '/v1/chat/completions', 'auto');
    expect(result).toBeTypeOf('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('truncates x-claude-code-session-id to 256 chars', () => {
    const longId = 'x'.repeat(300);
    const headers = mockHeaders({ 'x-claude-code-session-id': longId });
    const result = deriveSessionId(headers, undefined, '/v1/chat/completions', 'auto');
    expect(result!.length).toBe(256);
  });

  it('returns same fingerprint for same content in "always" mode', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Same question' }],
    };
    const headers = mockHeaders();
    const a = deriveSessionId(headers, body, '/v1/chat/completions', 'always');
    const b = deriveSessionId(headers, body, '/v1/chat/completions', 'always');
    expect(a).toBe(b);
  });

  it('"auto" without any client ID falls back to fingerprint', () => {
    const body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const result = deriveSessionId(mockHeaders(), body, '/v1/chat/completions', 'auto');
    expect(result).toBeTypeOf('string');
    expect(result!.length).toBe(64);
  });

  it('"always" without body falls back to proxy UUID', () => {
    const headers = mockHeaders({ 'x-claude-code-session-id': 'should-be-ignored' });
    const result = deriveSessionId(headers, undefined, '/v1/chat/completions', 'always');
    expect(result).toBeTypeOf('string');
    expect(result).not.toBe('should-be-ignored');
  });
});
