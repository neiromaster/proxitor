import type { SseMessage } from './sse-parser.js';

export function formatSseMessage(message: SseMessage): string {
  const lines: string[] = [];
  if (message.event !== undefined) lines.push(`event: ${message.event}`);
  for (const line of message.data.split('\n')) lines.push(`data: ${line}`);
  lines.push('', '');
  return lines.join('\n');
}

/** Codec convenience: JSON-stringify a payload and render it as one SSE message. */
export function formatSseEvent(
  payload: Record<string, unknown>,
  eventName?: string,
): string {
  return formatSseMessage({
    ...(eventName !== undefined ? { event: eventName } : {}),
    data: JSON.stringify(payload),
  });
}
