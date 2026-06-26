import { describe, expect, it, vi } from 'vitest';
import { buildErrorResponse } from './forward-request.js';

const ctx = { reqId: 'r1', method: 'POST', path: '/v1/chat/completions' };

describe('buildErrorResponse', () => {
  it('returns 502 for a network TypeError and skips the unhandled hook', () => {
    // Arrange
    const onUnhandled = vi.fn();
    // Act
    const response = buildErrorResponse(new TypeError('fetch failed'), ctx, onUnhandled);
    // Assert
    expect(response.status).toBe(502);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('returns 499 for a client AbortError and skips the unhandled hook', () => {
    // Arrange
    const onUnhandled = vi.fn();
    // Act
    const response = buildErrorResponse(
      new DOMException('aborted', 'AbortError'),
      ctx,
      onUnhandled,
    );
    // Assert
    expect(response.status).toBe(499);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('invokes the unhandled hook exactly once, then re-throws an unexpected error', () => {
    // Arrange — a non-network, non-abort error reaches the throw path; the
    // hook must fire first so the attempt is observed before propagation.
    const onUnhandled = vi.fn();
    // Act + Assert
    expect(() => buildErrorResponse(new Error('boom'), ctx, onUnhandled)).toThrow('boom');
    expect(onUnhandled).toHaveBeenCalledTimes(1);
  });
});
