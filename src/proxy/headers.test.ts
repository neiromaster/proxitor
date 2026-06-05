import { describe, expect, it } from 'vitest';
import type { ProxyConfig } from '../config.js';
import { DEFAULTS } from '../config.js';
import { buildRequestHeaders } from './headers.js';

const baseConfig: ProxyConfig = { ...DEFAULTS, openrouterKey: 'test-key' };

describe('buildRequestHeaders', () => {
  it('should build basic headers without extraHeaders', () => {
    const incoming = new Headers();
    const headers = buildRequestHeaders(incoming, baseConfig, false);
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['HTTP-Referer']).toBe('https://github.com/neiromaster/proxitor');
    expect(headers['X-OpenRouter-Title']).toBe('proxitor');
    expect(headers['Accept-Encoding']).toBe('identity');
  });

  it('should apply extraHeaders on top of standard headers', () => {
    const incoming = new Headers();
    const headers = buildRequestHeaders(incoming, baseConfig, false, {
      'X-Custom': 'model-specific',
    });
    expect(headers['X-Custom']).toBe('model-specific');
    expect(headers.Authorization).toBe('Bearer test-key');
  });

  it('should set Content-Type when inject is true', () => {
    const incoming = new Headers();
    const headers = buildRequestHeaders(incoming, baseConfig, true);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should not set Content-Type when inject is false', () => {
    const incoming = new Headers();
    const headers = buildRequestHeaders(incoming, baseConfig, false);
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('should strip authorization and host from incoming headers', () => {
    const incoming = new Headers({
      authorization: 'Bearer old-token',
      host: 'example.com',
      'x-forwarded-for': '1.2.3.4',
    });
    const headers = buildRequestHeaders(incoming, baseConfig, false);
    expect(headers.authorization).toBeUndefined();
    expect(headers.host).toBeUndefined();
    expect(headers['x-forwarded-for']).toBe('1.2.3.4');
  });

  it('should strip x-claude-code-session-id from incoming headers', () => {
    const incoming = new Headers({
      'x-claude-code-session-id': 'session-abc123',
    });
    const headers = buildRequestHeaders(incoming, baseConfig, false);
    expect(headers['x-claude-code-session-id']).toBeUndefined();
  });

  it('should use OAuth prefix when authType is oauth', () => {
    const incoming = new Headers();
    const config = { ...baseConfig, authType: 'oauth' as const };
    const headers = buildRequestHeaders(incoming, config, false);
    expect(headers.Authorization).toBe('OAuth test-key');
  });

  it('should use Bearer prefix when authType is bearer', () => {
    const incoming = new Headers();
    const config = { ...baseConfig, authType: 'bearer' as const };
    const headers = buildRequestHeaders(incoming, config, false);
    expect(headers.Authorization).toBe('Bearer test-key');
  });
});
