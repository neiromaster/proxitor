import type { LoggerPort } from '@proxitor/plugin-api';
import { createConsola } from 'consola';

/** consola → LoggerPort (spec §3.1); verbose flips the level so debug logs appear. */
export function consolaLogger(verbose: boolean): LoggerPort {
  const log = createConsola({ level: verbose ? 5 : 3 }).withTag('proxitor');
  return {
    info: (message, context) => log.info(message, context),
    warn: (message, context) => log.warn(message, context),
    error: (message, context) => log.error(message, context),
    debug: (message, context) => log.debug(message, context),
  };
}
