import { describe, expect, test } from 'vitest';
import { consolaLogger } from './logger.js';

describe('consolaLogger', () => {
  test('implements the LoggerPort shape for all four levels without throwing', () => {
    const logger = consolaLogger(true);
    expect(() => {
      logger.info('i', { a: 1 });
      logger.warn('w');
      logger.error('e');
      logger.debug('d');
    }).not.toThrow();
  });
});
