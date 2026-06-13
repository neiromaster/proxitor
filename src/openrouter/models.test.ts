import { describe, expect, it } from 'vitest';
import { formatPrice, parseModelAuthor, parseModelSlug } from './models.js';

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
  it('extracts author from model id', () => {
    // Arrange
    const modelId = 'anthropic/claude-sonnet-4';
    // Act
    const result = parseModelAuthor(modelId);
    // Assert
    expect(result).toBe('anthropic');
  });

  it('extracts author for openai models', () => {
    // Arrange
    const modelId = 'openai/gpt-4o';
    // Act
    const result = parseModelAuthor(modelId);
    // Assert
    expect(result).toBe('openai');
  });
});

describe('parseModelSlug', () => {
  it('extracts slug from model id', () => {
    // Arrange
    const modelId = 'anthropic/claude-sonnet-4';
    // Act
    const result = parseModelSlug(modelId);
    // Assert
    expect(result).toBe('claude-sonnet-4');
  });

  it('extracts slug for google models', () => {
    // Arrange
    const modelId = 'google/gemini-2.5-pro';
    // Act
    const result = parseModelSlug(modelId);
    // Assert
    expect(result).toBe('gemini-2.5-pro');
  });
});
