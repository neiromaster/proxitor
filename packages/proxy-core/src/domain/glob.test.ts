import { describe, expect, test } from 'vitest';
import { compileGlob, globMatch } from './glob.js';

describe('compileGlob', () => {
  const cases: readonly [pattern: string, value: string, expected: boolean][] = [
    ['*', 'anything-at-all', true],
    ['gpt-5*', 'gpt-5.2-preview', true],
    ['gpt-5*', 'claude-opus-4-1', false],
    ['claude-opus-4-1', 'CLAUDE-OPUS-4-1', true], // case-insensitive
    ['a*b*c', 'abc', true], // * matches empty
    ['a*b*c', 'axxbyyc', true],
    ['a*b*c', 'acb', false],
    ['model.name', 'modelXname', false], // dot is literal
  ];

  for (const [pattern, value, expected] of cases) {
    test(`${pattern} vs ${value} → ${expected}`, () => {
      // Arrange / Act / Assert
      expect(compileGlob(pattern)(value)).toBe(expected);
    });
  }

  test('matches globMatch semantics for every case', () => {
    // Arrange / Act / Assert
    for (const [pattern, value] of cases) {
      expect(compileGlob(pattern)(value)).toBe(globMatch(pattern, value));
    }
  });
});

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
