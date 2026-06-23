import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankModels } from './fuzzy.js';

/** Minimal model stub — only id/name are consulted by the matcher. */
const model = (id: string, name = '') => ({ id, name });

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    // Arrange — 'anthropic/claude-opus' has no 'x'
    // Act
    const result = fuzzyScore('anthropic/claude-opus', 'xyz');
    // Assert
    expect(result).toBeNull();
  });

  it('scores a present subsequence', () => {
    // Arrange
    // Act
    const result = fuzzyScore('anthropic/claude-opus', 'claude');
    // Assert
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0);
  });

  it('matches case-insensitively', () => {
    // Arrange — mixed-case target and query
    // Act / Assert
    expect(fuzzyScore('Anthropic/CLAUDE-Opus', 'claude')).not.toBeNull();
    expect(fuzzyScore('anthropic/claude-opus', 'CLAUDE')).not.toBeNull();
  });

  it('scores consecutive matches higher than scattered matches', () => {
    // Arrange — 'ab' sits adjacent in the first target, split in the second
    // Act
    const consecutive = fuzzyScore('ab', 'ab');
    const scattered = fuzzyScore('a-x-b', 'ab');
    // Assert
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive).toBeGreaterThan(scattered as number);
  });

  it('scores word-boundary matches higher than interior matches', () => {
    // Arrange — 'opus' is a clean suffix after '-' vs. scattered inside 'copious'
    // Act
    const boundary = fuzzyScore('claude-opus', 'opus');
    const interior = fuzzyScore('copious', 'opus');
    // Assert
    expect(boundary).not.toBeNull();
    expect(interior).not.toBeNull();
    expect(boundary).toBeGreaterThan(interior as number);
  });
});

describe('rankModels', () => {
  it('returns all models in original order for an empty query', () => {
    // Arrange
    const models = [model('a/one'), model('b/two'), model('c/three')];
    // Act
    const result = rankModels(models, '');
    // Assert
    expect(result.map(m => m.id)).toEqual(['a/one', 'b/two', 'c/three']);
  });

  it('excludes models where the query is not a subsequence', () => {
    // Arrange
    const models = [model('anthropic/claude-opus'), model('openai/gpt-4o')];
    // Act
    const result = rankModels(models, 'gpt4o');
    // Assert
    expect(result.map(m => m.id)).toEqual(['openai/gpt-4o']);
  });

  it('ranks the best match first', () => {
    // Arrange — 'opus' is scattered inside 'copious' but a clean boundary suffix in 'claude-opus'
    const models = [model('vendor/copious-thing'), model('anthropic/claude-opus')];
    // Act
    const result = rankModels(models, 'opus');
    // Assert
    expect(result.map(m => m.id)).toEqual([
      'anthropic/claude-opus',
      'vendor/copious-thing',
    ]);
  });

  it('matches across the id and name fields', () => {
    // Arrange — '7'/'0' live in the name, not the id
    const models = [model('meta/llama', 'Llama 3.1 70B')];
    // Act
    const result = rankModels(models, 'llama70');
    // Assert
    expect(result.map(m => m.id)).toEqual(['meta/llama']);
  });

  it('resolves realistic acronym-style queries', () => {
    // Arrange
    const models = [
      model('openai/gpt-4o', 'GPT-4o'),
      model('anthropic/claude-opus', 'Claude Opus'),
      model('google/gemini-flash', 'Gemini Flash'),
    ];
    // Act / Assert
    expect(rankModels(models, 'claudops')[0]?.id).toBe('anthropic/claude-opus');
    expect(rankModels(models, 'gpt4o')[0]?.id).toBe('openai/gpt-4o');
  });
});
