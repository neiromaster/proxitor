import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClockPort, RandomPort } from '@proxitor/plugin-api';
import { bench, describe } from 'vitest';
import { compileGlob, globMatch } from '../../domain/glob.js';
import { createRoutingTable, type RoutingConfig } from '../../domain/routing.js';
import { decodeAnthropicRequest } from '../anthropic-messages/decode-request.js';
import { createAnthropicStreamDecoder } from '../anthropic-messages/decode-stream.js';
import { decodeOpenAiRequest } from '../openai-chat/decode-request.js';
import { encodeOpenAiRequest } from '../openai-chat/encode-request.js';
import { createOpenAiStreamEncoder } from '../openai-chat/encode-stream.js';

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '__fixtures__',
  'cross-format',
);
const readFixture = (name: string) => readFileSync(join(fixtures, name), 'utf-8');

// Deterministic clock and random for benchmarks (no Math.random, no Date.now)
const clock: ClockPort = { now: () => 1755596800000 };
const random: RandomPort = { uuid: () => 'fixed-benchmark-uuid' };

// Synthetic conversation payloads: deterministic, no Math.random.
function syntheticAnthropicRequest(messageCount: number) {
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: [
      {
        type: 'text',
        text: `message ${i} — Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
      },
    ],
  }));
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    stream: true,
    messages,
  };
}

describe('request transform', () => {
  bench('decode anthropic request (fixture, CC-sized)', () => {
    decodeAnthropicRequest(readFixture('cc-claude-to-openai.request.json'));
  });
  bench('decode→encode anthropic→openai roundtrip (fixture)', () => {
    encodeOpenAiRequest(
      decodeAnthropicRequest(readFixture('cc-claude-to-openai.request.json')),
    );
  });
  for (const size of [10, 50, 200]) {
    bench(`decode→encode anthropic→openai (${size} messages, synthetic)`, () => {
      encodeOpenAiRequest(
        decodeAnthropicRequest(JSON.stringify(syntheticAnthropicRequest(size))),
      );
    });
  }
  bench('decode openai request (fixture)', () => {
    decodeOpenAiRequest(readFixture('openai-to-anthropic.expected-anthropic.json'));
  });
});

describe('stream transform', () => {
  bench('anthropic SSE → canonical → openai SSE (fixture)', () => {
    const sse = readFixture('tools-stream.anthropic.sse.txt');
    const decoder = createAnthropicStreamDecoder();
    const encoder = createOpenAiStreamEncoder({ model: 'gpt-5', clock, random });

    // Decode anthropic SSE to canonical events
    const events: string[] = [];
    for (const chunk of sse.split('\n\n')) {
      if (chunk.trim() === '') continue;
      const canonicalEvents = decoder.push(chunk);
      // Encode each canonical event back to OpenAI SSE
      for (const event of canonicalEvents) {
        events.push(encoder.push(event));
      }
    }
    // Drain any remaining events from decoder
    const remaining = decoder.end();
    for (const event of remaining) {
      events.push(encoder.push(event));
    }
    // Finalize encoder
    events.push(encoder.end());

    // Consume the output to prevent dead code elimination
    events.length;
  });
});

const benchRoutingConfig = (bindingCount: number): RoutingConfig => ({
  providers: {
    openai: {
      id: 'openai',
      baseUrl: 'https://api.openai.com',
      wireFormat: 'openai-chat',
      auth: { type: 'bearer', credential: { env: 'OPENAI_API_KEY' } },
    },
  },
  models: Array.from({ length: bindingCount }, (_, i) => ({
    match: `model-family-${i}-*`,
    provider: 'openai',
    modelId: '$MODEL',
  })),
  defaultProvider: 'openai',
});

describe('routing', () => {
  bench('createRoutingTable (100 bindings)', () => {
    createRoutingTable(benchRoutingConfig(100));
  });
  bench('resolve on 100-binding table', () => {
    const table = createRoutingTable(benchRoutingConfig(100));
    table.resolve('model-family-99-preview', '/v1/messages');
  });
  bench('compileGlob vs globMatch (1000 calls)', () => {
    const matches = compileGlob('model-family-*');
    for (let i = 0; i < 1000; i++) matches(`model-family-${i}`);
    for (let i = 0; i < 1000; i++) globMatch('model-family-*', `model-family-${i}`);
  });
});
