import { describe, expect, it } from 'vitest';
import { filterHeaders, STRIP_REQUEST } from './headers.js';

describe('filterHeaders', () => {
  it('should strip authorization and host from incoming headers', () => {
    const incoming = new Headers({
      authorization: 'Bearer old-token',
      host: 'example.com',
      'x-forwarded-for': '1.2.3.4',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers.authorization).toBeUndefined();
    expect(headers.host).toBeUndefined();
    expect(headers['x-forwarded-for']).toBe('1.2.3.4');
  });

  it('passes through x-claude-code-session-id (stripped later by middleware)', () => {
    const incoming = new Headers({
      'x-claude-code-session-id': 'session-abc123',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-claude-code-session-id']).toBe('session-abc123');
  });

  it('passes through x-session-id (stripped later by middleware)', () => {
    const incoming = new Headers({
      'x-session-id': 'client-session-456',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-session-id']).toBe('client-session-456');
  });

  it('passes through both session headers simultaneously', () => {
    const incoming = new Headers({
      'x-claude-code-session-id': 'session-abc',
      'x-session-id': 'session-xyz',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-claude-code-session-id']).toBe('session-abc');
    expect(headers['x-session-id']).toBe('session-xyz');
  });

  it('should strip hop-by-hop headers', () => {
    const incoming = new Headers({
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'x-custom': 'value',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers.connection).toBeUndefined();
    expect(headers['keep-alive']).toBeUndefined();
    expect(headers['transfer-encoding']).toBeUndefined();
    expect(headers['x-custom']).toBe('value');
  });

  it('should strip x-api-key and content-length', () => {
    const incoming = new Headers({
      'x-api-key': 'secret',
      'content-length': '1234',
    });
    const headers = filterHeaders(incoming, STRIP_REQUEST);
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['content-length']).toBeUndefined();
  });
});
