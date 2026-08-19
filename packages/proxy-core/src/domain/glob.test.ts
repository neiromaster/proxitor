import { describe, expect, test } from 'vitest';
import { globMatch } from './glob.js';

describe('globMatch', () => {
  test('exact pattern matches only the identical value', () => {
    // Arrange / Act / Assert
    expect(globMatch('gpt-5', 'gpt-5')).toBe(true);
    expect(globMatch('gpt-5', 'gpt-5-mini')).toBe(false);
  });

  test('matching is case-insensitive (spec D5)', () => {
    // Arrange / Act / Assert
    expect(globMatch('claude-opus*', 'Claude-Opus-4-1')).toBe(true);
    expect(globMatch('GPT-5', 'gpt-5')).toBe(true);
  });

  test('star matches any sequence including empty', () => {
    // Arrange / Act / Assert
    expect(globMatch('claude-opus*', 'claude-opus')).toBe(true);
    expect(globMatch('claude-opus*', 'claude-opus-4-1')).toBe(true);
    expect(globMatch('*-mini', 'gpt-5-mini')).toBe(true);
    expect(globMatch('*-mini', 'gpt-5')).toBe(false);
  });

  test('multiple stars compose', () => {
    // Arrange / Act / Assert
    expect(globMatch('*opus*', 'claude-opus-4-1')).toBe(true);
    expect(globMatch('a*b*c', 'aXbYc')).toBe(true);
    expect(globMatch('a*b*c', 'aXc')).toBe(false);
  });

  test('bare star matches everything (fallback binding)', () => {
    // Arrange / Act / Assert
    expect(globMatch('*', 'anything-at-all')).toBe(true);
    expect(globMatch('*', '')).toBe(true);
  });

  test('regex metacharacters in the pattern are literal', () => {
    // Arrange / Act / Assert
    expect(globMatch('gpt-4.1', 'gpt-4.1')).toBe(true);
    expect(globMatch('gpt-4.1', 'gpt-4X1')).toBe(false);
    expect(globMatch('a+b', 'a+b')).toBe(true);
    expect(globMatch('a+b', 'aab')).toBe(false);
  });
});
