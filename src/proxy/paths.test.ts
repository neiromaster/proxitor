import { describe, expect, it } from 'vitest';
import type { ProxyConfig } from '../config.js';
import { buildUpstreamUrl, classifyEndpoint, INJECT_PATHS } from './paths.js';

// ---------------------------------------------------------------------------
// classifyEndpoint
// ---------------------------------------------------------------------------

describe('classifyEndpoint', () => {
  it('classifies /v1/chat/completions', () => {
    expect(classifyEndpoint('/v1/chat/completions')).toBe('chat-completions');
  });

  it('classifies /v1/responses', () => {
    expect(classifyEndpoint('/v1/responses')).toBe('responses');
  });

  it('classifies /v1/messages', () => {
    expect(classifyEndpoint('/v1/messages')).toBe('messages');
  });

  it('returns "other" for unknown paths', () => {
    expect(classifyEndpoint('/v1/embeddings')).toBe('other');
    expect(classifyEndpoint('/v1/models')).toBe('other');
    expect(classifyEndpoint('/health')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// INJECT_PATHS
// ---------------------------------------------------------------------------

describe('INJECT_PATHS', () => {
  it('contains exactly the 3 expected paths', () => {
    expect(INJECT_PATHS).toEqual(
      new Set(['/v1/chat/completions', '/v1/responses', '/v1/messages']),
    );
  });
});

// ---------------------------------------------------------------------------
// buildUpstreamUrl
// ---------------------------------------------------------------------------

describe('buildUpstreamUrl', () => {
  const makeConfig = (baseUrl: string) => ({ openrouterBaseUrl: baseUrl }) as ProxyConfig;

  it('concatenates base URL with pathname', () => {
    expect(
      buildUpstreamUrl('/v1/chat/completions', makeConfig('https://openrouter.ai/api')),
    ).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('works with trailing-slash base URL', () => {
    expect(
      buildUpstreamUrl('/v1/messages', makeConfig('https://openrouter.ai/api/')),
    ).toBe('https://openrouter.ai/api//v1/messages');
  });

  it('works with custom base URL', () => {
    expect(buildUpstreamUrl('/v1/responses', makeConfig('http://localhost:8080'))).toBe(
      'http://localhost:8080/v1/responses',
    );
  });

  it('preserves a single query parameter', () => {
    expect(
      buildUpstreamUrl(
        '/v1/chat/completions?stream=true',
        makeConfig('https://openrouter.ai/api'),
      ),
    ).toBe('https://openrouter.ai/api/v1/chat/completions?stream=true');
  });

  it('preserves multiple query parameters', () => {
    expect(
      buildUpstreamUrl(
        '/v1/models?order=price&test=foo',
        makeConfig('https://openrouter.ai/api'),
      ),
    ).toBe('https://openrouter.ai/api/v1/models?order=price&test=foo');
  });
});
