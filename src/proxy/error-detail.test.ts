import { describe, expect, it } from 'vitest';
import { extractErrorDetail } from '../proxy.js';

describe('extractErrorDetail', () => {
  it('extracts message from OpenRouter-style error', () => {
    const body = JSON.stringify({
      error: { code: 400, message: 'Bad Request (invalid or missing params)' },
    });
    expect(extractErrorDetail(body)).toBe(
      '400 | Bad Request (invalid or missing params)',
    );
  });

  it('extracts message without code', () => {
    const body = JSON.stringify({
      error: { message: 'Rate limited' },
    });
    expect(extractErrorDetail(body)).toBe('Rate limited');
  });

  it('extracts provider_name from metadata', () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'Provider returned error',
        metadata: { provider_name: 'Anthropic', raw: 'invalid x-api-key' },
      },
    });
    expect(extractErrorDetail(body)).toBe(
      '400 | Provider returned error | provider=Anthropic | invalid x-api-key',
    );
  });

  it('extracts raw as object from metadata', () => {
    const body = JSON.stringify({
      error: {
        code: 502,
        message: 'Provider error',
        metadata: {
          provider_name: 'OpenAI',
          raw: { type: 'server_error', message: 'Internal error' },
        },
      },
    });
    expect(extractErrorDetail(body)).toBe(
      '502 | Provider error | provider=OpenAI | {"type":"server_error","message":"Internal error"}',
    );
  });

  it('extracts metadata without raw', () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: 'Request blocked',
        metadata: { provider_name: 'Anthropic' },
      },
    });
    expect(extractErrorDetail(body)).toBe('403 | Request blocked | provider=Anthropic');
  });

  it('extracts top-level message when error object is absent', () => {
    const body = JSON.stringify({ message: 'Something went wrong' });
    expect(extractErrorDetail(body)).toBe('Something went wrong');
  });

  it('returns raw text for non-JSON body', () => {
    expect(extractErrorDetail('Bad Gateway')).toBe('Bad Gateway');
  });

  it('returns raw text for invalid JSON', () => {
    expect(extractErrorDetail('{not json')).toBe('{not json');
  });

  it('returns raw text for JSON without error or message', () => {
    expect(extractErrorDetail(JSON.stringify({ status: 'ok' }))).toBe('{"status":"ok"}');
  });
});
