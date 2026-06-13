import { describe, expect, it } from 'vitest';
import {
  formatContextLength,
  formatLatency,
  formatPricing,
  formatThroughput,
} from './format.js';

describe('formatPricing', () => {
  it('formats prompt and completion pricing', () => {
    // Arrange
    const prompt = '0.000003';
    const completion = '0.000015';
    // Act
    const result = formatPricing(prompt, completion);
    // Assert
    expect(result).toBe('$3.00 / $15.00');
  });

  it('formats free pricing', () => {
    // Arrange
    const prompt = '0';
    const completion = '0';
    // Act
    const result = formatPricing(prompt, completion);
    // Assert
    expect(result).toBe('free / free');
  });
});

describe('formatContextLength', () => {
  it('formats thousands with k suffix', () => {
    // Arrange
    const tokens = 200000;
    // Act
    const result = formatContextLength(tokens);
    // Assert
    expect(result).toBe('200k');
  });

  it('formats millions with M suffix', () => {
    // Arrange
    const tokens = 1000000;
    // Act
    const result = formatContextLength(tokens);
    // Assert
    expect(result).toBe('1.0M');
  });

  it('formats small numbers without suffix', () => {
    // Arrange
    const tokens = 500;
    // Act
    const result = formatContextLength(tokens);
    // Assert
    expect(result).toBe('500');
  });
});

describe('formatLatency', () => {
  it('formats null as N/A', () => {
    // Arrange
    const ms: number | null = null;
    // Act
    const result = formatLatency(ms);
    // Assert
    expect(result).toBe('N/A');
  });

  it('formats milliseconds with ms suffix', () => {
    // Arrange
    const ms = 500;
    // Act
    const result = formatLatency(ms);
    // Assert
    expect(result).toBe('500ms');
  });

  it('formats seconds with s suffix', () => {
    // Arrange
    const ms = 1137;
    // Act
    const result = formatLatency(ms);
    // Assert
    expect(result).toBe('1.1s');
  });
});

describe('formatThroughput', () => {
  it('formats null as N/A', () => {
    // Arrange
    const tps: number | null = null;
    // Act
    const result = formatThroughput(tps);
    // Assert
    expect(result).toBe('N/A');
  });

  it('formats tokens per second', () => {
    // Arrange
    const tps = 42;
    // Act
    const result = formatThroughput(tps);
    // Assert
    expect(result).toBe('42 t/s');
  });
});
