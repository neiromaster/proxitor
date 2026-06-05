import { createConsola } from 'consola';

/**
 * Custom logger with consistent left-aligned output.
 *
 * Consola's default fancy mode places the tag on the right for short lines
 * and on the left for long lines when a date/time is shown, making timestamps
 * jump between positions. Disabling date/time in formatOptions keeps the
 * tag always on the left while preserving the icon (ℹ ✓ ⚠) and colors.
 */
export const logger = createConsola({
  formatOptions: { date: false, time: false },
});

/** Generate a short request ID (first 8 hex chars of a UUID) */
export function requestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Format a log message with a request ID prefix. */
export function withReq(id: string, message: string): string {
  return `[${id}] ${message}`;
}
