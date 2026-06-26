import { describe, expect, it } from 'vitest';
import { parseModelAuthor, parseModelSlug } from '../model-id.js';
import { formatPrice } from './models.js';

describe('formatPrice', () => {
  it('returns "free" for zero price', () => {
    // Arrange
    const price = '0';
    // Act
    const result = formatPrice(price);
    // Assert
    expect(result).toBe('free');
  });

  it('formats $3.00 for 0.000003 per token', () => {
    // Arrange
    const price = '0.000003';
    // Act
    const result = formatPrice(price);
    // Assert
    expect(result).toBe('$3.00');
  });

  it('formats $8.00 for 0.000008 per token', () => {
    // Arrange
    const price = '0.000008';
    // Act
    const result = formatPrice(price);
    // Assert
    expect(result).toBe('$8.00');
  });

  it('shows 4 decimals for sub-cent prices', () => {
    // Arrange — sub-cent price ($0.005/1M) triggers 4-decimal format
    const price = '0.000000005';
    // Act
    const result = formatPrice(price);
    // Assert
    expect(result).toBe('$0.0050');
  });
});

describe('parseModelAuthor', () => {
  it('extracts the vendor segment from a prefixed id', () => {
    // Arrange
    const modelId = 'anthropic/claude-sonnet-4';
    // Act
    const result = parseModelAuthor(modelId);
    // Assert
    expect(result).toBe('anthropic');
  });

  it('returns the whole id when there is no slash (bare id)', () => {
    // Arrange — documented behavior: a bare "gpt-4o" is its own author.
    const modelId = 'gpt-4o';
    // Act
    const result = parseModelAuthor(modelId);
    // Assert
    expect(result).toBe('gpt-4o');
  });

  it('returns only the first segment of a multi-segment id', () => {
    // Arrange — only the segment before the first "/" is the author.
    const modelId = 'vendor/sub/model';
    // Act
    const result = parseModelAuthor(modelId);
    // Assert
    expect(result).toBe('vendor');
  });
});

describe('parseModelSlug', () => {
  it('extracts the slug from a prefixed id', () => {
    // Arrange
    const modelId = 'anthropic/claude-sonnet-4';
    // Act
    const result = parseModelSlug(modelId);
    // Assert
    expect(result).toBe('claude-sonnet-4');
  });

  it('returns an empty string when there is no slash (bare id)', () => {
    // Arrange — a bare id has no slug portion after the "/".
    const modelId = 'gpt-4o';
    // Act
    const result = parseModelSlug(modelId);
    // Assert
    expect(result).toBe('');
  });

  it('keeps everything after the first slash for a multi-segment id', () => {
    // Arrange — the slug is the remainder after the first "/", slashes included.
    const modelId = 'vendor/sub/model';
    // Act
    const result = parseModelSlug(modelId);
    // Assert
    expect(result).toBe('sub/model');
  });
});
