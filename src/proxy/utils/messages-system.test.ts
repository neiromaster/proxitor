import { describe, expect, it } from 'vitest';
import { liftSystemMessages, shouldNormalizeMessages } from './messages-system.js';

type RoleMsg = { role?: string; content?: unknown };

function roles(body: Record<string, unknown>): string[] {
  return (body.messages as RoleMsg[] | undefined)?.map(m => m.role ?? '') ?? [];
}

// ---------------------------------------------------------------------------
// shouldNormalizeMessages
// ---------------------------------------------------------------------------

describe('shouldNormalizeMessages', () => {
  it('returns false for skip regardless of path', () => {
    expect(shouldNormalizeMessages('skip', '/v1/messages')).toBe(false);
  });

  it('returns true for always regardless of path', () => {
    expect(shouldNormalizeMessages('always', '/v1/chat/completions')).toBe(true);
  });

  it('returns true for auto only on /v1/messages', () => {
    expect(shouldNormalizeMessages('auto', '/v1/messages')).toBe(true);
    expect(shouldNormalizeMessages('auto', '/v1/chat/completions')).toBe(false);
    expect(shouldNormalizeMessages('auto', '/v1/responses')).toBe(false);
  });

  it('ignores a query string when classifying the path', () => {
    expect(shouldNormalizeMessages('auto', '/v1/messages?beta=true')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// liftSystemMessages
// ---------------------------------------------------------------------------

describe('liftSystemMessages', () => {
  it('lifts a role:system item into top-level system and removes it', () => {
    // Arrange
    const body: Record<string, unknown> = {
      system: 'base',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'be helpful' },
        { role: 'assistant', content: 'ok' },
      ],
    };
    // Act
    const changed = liftSystemMessages(body);
    // Assert
    expect(changed).toBe(true);
    expect(roles(body)).toEqual(['user', 'assistant']);
    expect(body.system).toBe('base\n\nbe helpful');
  });

  it('preserves user/assistant alternation after lifting a mid-thread system item', () => {
    // Arrange — the real failing shape: [user, system, assistant, user] from a
    // SessionStart hook injected as role:"system" at index 1.
    const body: Record<string, unknown> = {
      system: [{ type: 'text', text: 'sys' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'system', content: 'SessionStart: ...' },
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    };
    // Act
    const changed = liftSystemMessages(body);
    // Assert — removing the system item keeps user/assistant alternating.
    expect(changed).toBe(true);
    expect(roles(body)).toEqual(['user', 'assistant', 'user']);
  });

  it('appends to an existing system block array as a new text block', () => {
    // Arrange
    const body: Record<string, unknown> = {
      system: [{ type: 'text', text: 'first' }],
      messages: [{ role: 'system', content: 'second' }],
    };
    // Act
    liftSystemMessages(body);
    // Assert
    expect(body.system).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]);
    expect(body.messages).toHaveLength(0);
  });

  it('creates a top-level system string when none existed', () => {
    // Arrange
    const body: Record<string, unknown> = {
      messages: [{ role: 'system', content: 'only' }],
    };
    // Act
    liftSystemMessages(body);
    // Assert
    expect(body.system).toBe('only');
    expect(body.messages).toHaveLength(0);
  });

  it('extracts text from a system content-block array', () => {
    // Arrange
    const body: Record<string, unknown> = {
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    };
    // Act
    liftSystemMessages(body);
    // Assert
    expect(body.system).toBe('a\nb');
  });

  it('lifts multiple system items in encounter order', () => {
    // Arrange
    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: 'one' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'two' },
      ],
    };
    // Act
    liftSystemMessages(body);
    // Assert
    expect(body.system).toBe('one\n\ntwo');
    expect(roles(body)).toEqual(['user']);
  });

  it('drops a system item whose content has no extractable text', () => {
    // Arrange — an image-only system item can't move to `system`, so drop it;
    // never keep role:"system" in messages.
    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: [{ type: 'image', source: { url: 'x' } }] },
        { role: 'user', content: 'hi' },
      ],
    };
    // Act
    const changed = liftSystemMessages(body);
    // Assert
    expect(changed).toBe(true);
    expect(roles(body).some(r => r === 'system')).toBe(false);
    expect(body.system).toBeUndefined();
  });

  it('leaves user/assistant messages untouched when no system item is present', () => {
    // Arrange
    const body: Record<string, unknown> = {
      system: 'base',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey' },
      ],
    };
    // Act
    const changed = liftSystemMessages(body);
    // Assert
    expect(changed).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.system).toBe('base');
  });

  it('is idempotent — a second run reports no mutation', () => {
    // Arrange
    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
    };
    // Act / Assert
    expect(liftSystemMessages(body)).toBe(true);
    expect(liftSystemMessages(body)).toBe(false);
  });

  it('returns false when messages is missing or not an array', () => {
    expect(liftSystemMessages({})).toBe(false);
    expect(liftSystemMessages({ messages: 'nope' })).toBe(false);
  });

  it('matches the real failing dump shape (top-level system + mid-thread system message)', () => {
    // Arrange — dump 20260616-131122-469 (glm-5.1): /v1/messages with a
    // top-level system array AND a role:"system" at messages[1] holding the
    // SessionStart hook output. GLM rejects role:"system" in messages.
    const body: Record<string, unknown> = {
      model: 'glm-5.1',
      system: [
        { type: 'text', text: 'system prompt', cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>claudeMd</system-reminder>' },
          ],
        },
        { role: 'system', content: 'SessionStart:startup hook success: {...}' },
        { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
        { role: 'user', content: 'thanks' },
      ],
    };
    // Act
    const changed = liftSystemMessages(body);
    // Assert
    expect(changed).toBe(true);
    expect(roles(body)).toEqual(['user', 'assistant', 'user']);
    // Existing system block (with its cache_control) is preserved; lifted text
    // is appended as a fresh text block beyond the breakpoint.
    expect(body.system).toEqual([
      { type: 'text', text: 'system prompt', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SessionStart:startup hook success: {...}' },
    ]);
  });
});
