import { consola } from 'consola';

export const logger = consola.withTag('proxitor');

/** Generate a short request ID (first 8 hex chars of a UUID) */
export function requestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Format a log message with a request ID prefix. */
export function withReq(id: string, message: string): string {
  return `[${id}] ${message}`;
}
