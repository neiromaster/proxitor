import type { LoggerPort } from '@proxitor/plugin-api';
import { describe, expect, test } from 'vitest';
import {
  createObservability,
  type ObservationRecord,
  type ObservationSink,
} from './observability.js';

const logger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
const baseConfig = {
  routerMetadata: true,
  hitThreshold: 80,
  sideMaxTokens: 4096,
  sessionMaxEntries: 4096,
  sessionTtlMs: 600000,
};

function sink(): { records: ObservationRecord[] } & ObservationSink {
  const records: ObservationRecord[] = [];
  return { records, emit: r => records.push(r) };
}

describe('createObservability', () => {
  test('accumulates usage from message_delta cumulative partials then a usage event', () => {
    const s = sink();
    const obs = createObservability({ config: baseConfig, sinks: [s], logger });
    const ro = obs.begin({
      requestId: 'r1',
      model: 'claude-opus-4-1',
      toolsCount: 0,
      maxTokens: 32000,
    });
    ro.onEvent({
      type: 'message_delta',
      usage: { inputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 40 },
    });
    ro.onEvent({
      type: 'message_delta',
      usage: {
        inputTokens: 100,
        outputTokens: 12,
        cacheReadTokens: 60,
        cacheCreateTokens: 40,
      },
    });
    ro.onEvent({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 12,
        cacheReadTokens: 60,
        cacheCreateTokens: 40,
      },
    });
    ro.end(200);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]?.usage).toEqual({
      present: true,
      inputTokens: 100,
      outputTokens: 12,
      cacheRead: 60,
      cacheCreate: 40,
    });
    expect(s.records[0]?.outcome.label).toBe('PARTIAL'); // 60% < 80
  });

  test('end is idempotent — exactly one record per request', () => {
    const s = sink();
    const ro = createObservability({ config: baseConfig, sinks: [s], logger }).begin({
      requestId: 'r2',
      model: 'm',
      toolsCount: 1,
    });
    ro.end(200);
    ro.end(500);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]?.status).toBe(200);
  });

  test('routerMetadata=false drops provider/physicalModel from the record', () => {
    const s = sink();
    const config = { ...baseConfig, routerMetadata: false };
    const obs = createObservability({ config, sinks: [s], logger });
    const ro = obs.begin({
      requestId: 'r3',
      model: 'm',
      provider: 'p1',
      physicalModel: 'pm1',
      toolsCount: 0,
    });
    ro.end(200);
    expect(s.records[0]?.provider).toBeUndefined();
    expect(s.records[0]?.physicalModel).toBeUndefined();
  });

  test('sessionId repeats classify MISS, not COLD (tracker wired through begin)', () => {
    const s = sink();
    const obs = createObservability({ config: baseConfig, sinks: [s], logger });
    const ro1 = obs.begin({
      requestId: 'r4',
      model: 'm',
      sessionId: 's1',
      toolsCount: 0,
      maxTokens: 32000,
    });
    ro1.onEvent({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    });
    ro1.end(200);
    const ro2 = obs.begin({
      requestId: 'r5',
      model: 'm',
      sessionId: 's1',
      toolsCount: 0,
      maxTokens: 32000,
    });
    ro2.onEvent({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    });
    ro2.end(200);
    expect(s.records[0]?.outcome.label).toBe('COLD');
    expect(s.records[1]?.outcome.label).toBe('MISS');
  });

  test('a throwing sink never escapes and later sinks still run', () => {
    const throwingSink: ObservationSink = {
      emit: () => {
        throw new Error('sink error');
      },
    };
    const s = sink();
    const obs = createObservability({
      config: baseConfig,
      sinks: [throwingSink, s],
      logger,
    });
    const ro = obs.begin({ requestId: 'r6', model: 'm', toolsCount: 0 });
    ro.onEvent({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    });
    ro.end(200);
    expect(s.records).toHaveLength(1);
  });

  test('captureOutbound stores parsed body only when wantsOutboundBody', () => {
    const s1 = sink();
    const s2 = sink();
    const body = '{"request":"data"}';
    const obs1 = createObservability({
      config: baseConfig,
      sinks: [s1],
      logger,
      wantsOutboundBody: () => true,
    });
    const obs2 = createObservability({
      config: baseConfig,
      sinks: [s2],
      logger,
      wantsOutboundBody: () => false,
    });
    const ro1 = obs1.begin({ requestId: 'r7a', model: 'm', toolsCount: 0 });
    const ro2 = obs2.begin({ requestId: 'r7b', model: 'm', toolsCount: 0 });
    ro1.captureOutbound(body);
    ro2.captureOutbound(body);
    ro1.end(200);
    ro2.end(200);
    expect(s1.records[0]?.requestBody).toEqual({ request: 'data' });
    expect(s2.records[0]?.requestBody).toBeUndefined();
  });

  test('reconfigure applies new thresholds and tracker capacity without wiping sessions', () => {
    const s = sink();
    const obs = createObservability({ config: baseConfig, sinks: [s], logger });
    // First request with hitThreshold 80
    const ro1 = obs.begin({
      requestId: 'r8',
      model: 'm',
      sessionId: 's1',
      toolsCount: 0,
      maxTokens: 32000,
    });
    ro1.onEvent({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 60,
        cacheCreateTokens: 0,
      },
    });
    ro1.end(200);
    expect(s.records[0]?.outcome.label).toBe('PARTIAL'); // 60% < 80
    // Reconfigure with hitThreshold 10
    obs.reconfigure({ ...baseConfig, hitThreshold: 10 });
    // Same usage should now be HIT (60% >= 10)
    const ro2 = obs.begin({
      requestId: 'r9',
      model: 'm',
      sessionId: 's1',
      toolsCount: 0,
      maxTokens: 32000,
    });
    ro2.onEvent({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 60,
        cacheCreateTokens: 0,
      },
    });
    ro2.end(200);
    expect(s.records[1]?.outcome.label).toBe('HIT'); // 60% >= 10
  });
});
