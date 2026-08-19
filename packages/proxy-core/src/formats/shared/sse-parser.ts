export type SseMessage = { event?: string; data: string };

/** Incremental WHATWG-style SSE tokenizer: pure, tolerant, keep-alive comments ignored. */
export function createSseParser(): {
  push(chunk: string): SseMessage[];
  end(): SseMessage[];
} {
  let buffer = '';
  let pendingEvent: string | undefined;
  const dataLines: string[] = [];

  const dispatch = (): SseMessage[] => {
    if (dataLines.length === 0 && pendingEvent === undefined) return [];
    const message: SseMessage = { data: dataLines.join('\n') };
    if (pendingEvent !== undefined) message.event = pendingEvent;
    dataLines.length = 0;
    pendingEvent = undefined;
    return [message];
  };

  const processLine = (line: string): SseMessage[] => {
    if (line === '') return dispatch();
    if (line.startsWith(':')) return [];
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') pendingEvent = value;
    return [];
  };

  return {
    push(chunk: string): SseMessage[] {
      buffer += chunk;
      const out: SseMessage[] = [];
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        out.push(...processLine(line));
        nl = buffer.indexOf('\n');
      }
      return out;
    },
    end(): SseMessage[] {
      if (buffer !== '') {
        const line = buffer.replace(/\r$/, '');
        buffer = '';
        return [...processLine(line), ...dispatch()];
      }
      return dispatch();
    },
  };
}
