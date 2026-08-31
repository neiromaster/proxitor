import type { CanonicalEvent, RandomPort } from '@proxitor/plugin-api';

export type EventSequenceNormalizer = {
  end(): CanonicalEvent[];
  push(events: CanonicalEvent[]): CanonicalEvent[];
};

export function createEventSequenceNormalizer(options: {
  model: string;
  random: RandomPort;
}): EventSequenceNormalizer {
  const openBlocks = new Map<
    number,
    { type: 'text' | 'tool_use' | 'thinking'; sawSignature: boolean }
  >();
  let started = false;
  let stopped = false;

  function ensureStart(out: CanonicalEvent[]): void {
    if (!started) {
      started = true;
      out.push({
        type: 'message_start',
        id: `msg_${options.random.uuid()}`,
        model: options.model,
      });
    }
  }

  function ensureBlockStart(
    out: CanonicalEvent[],
    index: number,
    block:
      | { type: 'text' }
      | { type: 'tool_use'; id: string; name: string }
      | { type: 'thinking' },
  ): void {
    if (!openBlocks.has(index)) {
      openBlocks.set(index, { type: block.type, sawSignature: false });
      out.push({ type: 'content_block_start', index, block });
    }
  }

  function closeBlock(out: CanonicalEvent[], index: number): void {
    const open = openBlocks.get(index);
    if (open === undefined) return;
    if (open.type === 'thinking' && !open.sawSignature) {
      out.push({ type: 'signature_delta', index, signature: '' });
    }
    openBlocks.delete(index);
    out.push({ type: 'content_block_stop', index });
  }

  return {
    push(events) {
      const out: CanonicalEvent[] = [];
      if (stopped) return out;
      for (const event of events) {
        if (stopped) break;
        switch (event.type) {
          case 'message_start':
            if (!started) {
              started = true;
              out.push(event);
            }
            break;
          case 'message_stop':
            for (const index of [...openBlocks.keys()].sort((a, b) => a - b))
              closeBlock(out, index);
            stopped = true;
            out.push(event);
            break;
          case 'error':
            for (const index of [...openBlocks.keys()].sort((a, b) => a - b))
              closeBlock(out, index);
            stopped = true;
            out.push(event);
            break;
          case 'content_block_start':
            ensureStart(out);
            openBlocks.set(event.index, { type: event.block.type, sawSignature: false });
            out.push(event);
            break;
          case 'content_block_delta': {
            ensureStart(out);
            if (!openBlocks.has(event.index)) {
              if (event.delta.type === 'input_json') {
                ensureBlockStart(out, event.index, {
                  type: 'tool_use',
                  id: `toolu_${options.random.uuid()}`,
                  name: 'unknown_tool',
                });
              } else if (event.delta.type === 'thinking') {
                ensureBlockStart(out, event.index, { type: 'thinking' });
              } else {
                ensureBlockStart(out, event.index, { type: 'text' });
              }
            }
            out.push(event);
            break;
          }
          case 'signature_delta': {
            ensureStart(out);
            const open = openBlocks.get(event.index);
            if (open === undefined) {
              openBlocks.set(event.index, { type: 'thinking', sawSignature: true });
              out.push({
                type: 'content_block_start',
                index: event.index,
                block: { type: 'thinking' },
              });
            } else {
              open.sawSignature = true;
            }
            out.push(event);
            break;
          }
          case 'content_block_stop':
            ensureStart(out);
            if (openBlocks.has(event.index)) {
              closeBlock(out, event.index);
            } else {
              out.push(event);
            }
            break;
          default:
            ensureStart(out);
            out.push(event);
        }
      }
      return out;
    },
    end() {
      const out: CanonicalEvent[] = [];
      if (stopped) return out;
      for (const index of [...openBlocks.keys()].sort((a, b) => a - b))
        closeBlock(out, index);
      if (started) {
        stopped = true;
        out.push({ type: 'message_stop' });
      }
      return out;
    },
  };
}
