import { deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SseMessage } from './shared/sse-parser.js';
import { createSseParser } from './shared/sse-parser.js';

const fixturesRoot = new URL('./__fixtures__/', import.meta.url);

export function loadFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, fixturesRoot)), 'utf8');
}

/** Identity comparison canon: deep equality of parsed JSON (key order/whitespace insignificant). */
export function expectSameJson(actual: string, expected: string): void {
  deepStrictEqual(JSON.parse(actual), JSON.parse(expected));
}

/** openai identity canon: stream_options is injected by the encoder (spec §4.2), so both sides are stripped. */
export function expectSameJsonModuloStreamOptions(
  actual: string,
  expected: string,
): void {
  const strip = (text: string) => {
    const value = JSON.parse(text) as Record<string, unknown>;
    delete value.stream_options;
    return value;
  };
  deepStrictEqual(strip(actual), strip(expected));
}

export function parseSse(text: string): SseMessage[] {
  const parser = createSseParser();
  return [...parser.push(text), ...parser.end()];
}
