import { describe, expect, test, vi } from 'vitest';
import type { ObservationRecord } from '../application/observability.js';
import {
  DumpSink,
  type DumpSinkDeps,
  formatObservationLine,
  formatVerboseLine,
  LiveLineSink,
  VerboseLineSink,
} from './observability-sinks.js';

// Helper to create a minimal record
const baseRecord = (): ObservationRecord => ({
  requestId: 'req-123',
  status: 200,
  model: 'gpt-4',
  provider: 'openai',
  physicalModel: 'gpt-4-0613',
  sessionId: 'sess-456',
  requestType: 'main',
  toolsCount: 0,
  usage: {
    present: true,
    inputTokens: 100,
    outputTokens: 50,
    cacheRead: 0,
    cacheCreate: 0,
  },
  outcome: { label: 'MISS', hitPct: 0 },
  requestBody: { messages: [{ role: 'user', content: 'hello' }] },
});

describe('formatObservationLine', () => {
  test('formats line with all fields in correct order', () => {
    // Arrange
    const record = baseRecord();
    record.outcome = { label: 'HIT', hitPct: 85 };
    record.usage = {
      present: true,
      inputTokens: 100,
      outputTokens: 50,
      cacheRead: 200,
      cacheCreate: 50,
    };

    // Act
    const line = formatObservationLine(record, false);

    // Assert - pin exact legacy field order for log-parsing compatibility
    expect(line).toEqual(
      '[req-123] HIT  85%  read 200  write 50  in 100  provider=openai  gpt-4  [main]',
    );
  });

  test('omits empty model for log-parsing hygiene', () => {
    // Arrange
    const record = baseRecord();
    record.model = '';
    record.provider = undefined; // also omit provider when model is empty

    // Act
    const line = formatObservationLine(record, false);

    // Assert
    expect(line).not.toContain('provider=');
    expect(line).not.toContain('[] model'); // no empty model
  });

  test('NOUSAGE omits percentage', () => {
    // Arrange
    const record = baseRecord();
    record.outcome = { label: 'NOUSAGE', hitPct: 0 };

    // Act
    const line = formatObservationLine(record, false);

    // Assert
    expect(line).toContain('NOUSAGE');
    expect(line).not.toContain('%');
  });

  test('MISS omits percentage', () => {
    // Arrange
    const record = baseRecord();
    record.outcome = { label: 'MISS', hitPct: 0 };

    // Act
    const line = formatObservationLine(record, false);

    // Assert
    expect(line).toContain('MISS');
    expect(line).not.toContain('%');
  });

  test('omits provider when undefined', () => {
    // Arrange
    const record = baseRecord();
    record.provider = undefined;

    // Act
    const line = formatObservationLine(record, false);

    // Assert
    expect(line).not.toContain('provider=');
  });

  test('omits usage fields when not present', () => {
    // Arrange
    const record = baseRecord();
    record.usage = {
      present: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheCreate: 0,
    };

    // Act
    const line = formatObservationLine(record, false);

    // Assert
    expect(line).not.toContain('in ');
    expect(line).not.toContain('read ');
    expect(line).not.toContain('write ');
  });
});

describe('LiveLineSink', () => {
  test('calls info with formatted line, resolving color at emit time', () => {
    // Arrange
    const info = vi.fn();
    const sink = new LiveLineSink({ info, useColor: () => false });
    const record = baseRecord();

    // Act
    sink.emit(record);

    // Assert
    expect(info).toHaveBeenCalledTimes(1);
    const firstCall = info.mock.calls[0];
    if (!firstCall) throw new Error('info was not called');
    const line = firstCall[0] as string;
    expect(line).toContain('[req-123]');
    expect(line).toContain('MISS');
  });

  test('respects useColor thunk when true', () => {
    // Arrange
    const info = vi.fn();
    let colorCallCount = 0;
    const sink = new LiveLineSink({
      info,
      useColor: () => {
        colorCallCount++;
        return true;
      },
    });
    const record = baseRecord();

    // Act
    sink.emit(record);

    // Assert
    expect(colorCallCount).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('formatVerboseLine', () => {
  test('pins the verbose request line format', () => {
    // Arrange
    const record = baseRecord();
    record.outcome = { label: 'HIT', hitPct: 85 };

    // Act
    const line = formatVerboseLine(record);

    // Assert
    expect(line).toBe('[req-123] model=gpt-4 provider=openai status=200 cache=HIT');
  });

  test('uses - placeholder for absent provider and empty model', () => {
    // Arrange
    const record = baseRecord();
    record.provider = undefined;
    record.model = '';

    // Act
    const line = formatVerboseLine(record);

    // Assert
    expect(line).toBe('[req-123] model=- provider=- status=200 cache=MISS');
  });
});

describe('VerboseLineSink', () => {
  test('emits exactly one info line per record', () => {
    // Arrange
    const lines: string[] = [];
    const sink = new VerboseLineSink({
      info: (line: string) => {
        lines.push(line);
      },
    });

    // Act
    sink.emit(baseRecord());
    sink.emit(baseRecord());

    // Assert
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[req-123] model=gpt-4 provider=openai status=200 cache=MISS');
  });
});

describe('DumpSink', () => {
  test('is disabled by default (no writes)', async () => {
    // Arrange
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: {},
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 16,
      maxWaiters: 256,
    };
    const sink = new DumpSink(deps);
    const record = baseRecord();

    // Act
    sink.emit(record);
    await vi.waitFor(() => {}, { timeout: 50 }); // let any pending async settle

    // Assert
    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  test('when enabled, writes one JSON file with both halves + explicit nulls', async () => {
    // Arrange
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 16,
      maxWaiters: 256,
    };
    const sink = new DumpSink(deps);
    const record = baseRecord();
    record.requestBody = { messages: [{ role: 'user', content: 'test' }] };

    // Act
    sink.emit(record);
    await vi.waitFor(() => writeFile.mock.calls.length > 0, { timeout: 500 });

    // Assert
    expect(writeFile).toHaveBeenCalledTimes(1);
    const firstCall = writeFile.mock.calls[0];
    if (!firstCall) throw new Error('writeFile was not called');
    const written = JSON.parse(firstCall[1] as string);
    expect(written).toHaveProperty('ts');
    expect(written).toHaveProperty('request');
    expect(written.request).toEqual(record.requestBody);
    expect(written).toHaveProperty('response');
    expect(written.response.status).toBe(200);
    expect(written.response.label).toBe('MISS');
    expect(written.response.requestType).toBe('main');
    expect(written.response.model).toBe('gpt-4');
    expect(written.response.sessionId).toBe('sess-456');
    expect(written.response.provider).toBe('openai');
    expect(written.response.inputTokens).toBe(100);
    expect(written.response.outputTokens).toBe(50);
    expect(written.response.cacheRead).toBe(0);
    expect(written.response.cacheCreate).toBe(0);
    expect(written.response.hitPct).toBe(0);
  });

  test('explicit nulls for optional response fields', async () => {
    // Arrange
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
    };
    const sink = new DumpSink(deps);
    const record = baseRecord();
    record.provider = undefined;
    record.sessionId = undefined;

    // Act
    sink.emit(record);
    await vi.waitFor(() => writeFile.mock.calls.length > 0, { timeout: 500 });

    // Assert
    const firstCall = writeFile.mock.calls[0];
    if (!firstCall) throw new Error('writeFile was not called');
    const written = JSON.parse(firstCall[1] as string);
    expect(written.response.provider).toBeNull();
    expect(written.response.sessionId).toBeNull();
  });

  test('non-JSON requestBody passed through raw', async () => {
    // Arrange
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
    };
    const sink = new DumpSink(deps);
    const record = baseRecord();
    record.requestBody = 'not-json-at-all';

    // Act
    sink.emit(record);
    await vi.waitFor(() => writeFile.mock.calls.length > 0, { timeout: 500 });

    // Assert
    const firstCall = writeFile.mock.calls[0];
    if (!firstCall) throw new Error('writeFile was not called');
    const written = JSON.parse(firstCall[1] as string);
    expect(written.request).toBe('not-json-at-all');
  });

  test('queue-full drops when maxConcurrent=0 and maxWaiters=0', async () => {
    // Arrange
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 0,
      maxWaiters: 0,
    };
    const sink = new DumpSink(deps);
    const record = baseRecord();

    // Act
    sink.emit(record);
    await vi.waitFor(() => logger.debug.mock.calls.length > 0, { timeout: 100 });

    // Assert
    expect(writeFile).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
    const debugCall = logger.debug.mock.calls[0];
    if (!debugCall) throw new Error('logger.debug was not called');
    expect(debugCall[0]).toMatch(/queue full|dropped/);
  });

  test('slow-write scheduling honors maxConcurrent cap', async () => {
    // Arrange
    const resolveWrite: (() => void)[] = [];
    const writeFile = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => resolveWrite.push(r));
    });
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 2,
      maxWaiters: 10,
    };
    const sink = new DumpSink(deps);

    // Act - emit 5 records
    for (let i = 0; i < 5; i++) {
      const record = baseRecord();
      record.requestId = `req-${i}`;
      sink.emit(record);
    }
    await vi.waitFor(() => writeFile.mock.calls.length >= 2, { timeout: 100 });

    // Assert - only 2 should be writing (cap)
    expect(writeFile.mock.calls.length).toBeLessThanOrEqual(2);

    // Resolve the first two, verify more start
    resolveWrite[0]?.();
    resolveWrite[1]?.();
    await vi.waitFor(() => writeFile.mock.calls.length >= 4, { timeout: 100 });
    expect(writeFile.mock.calls.length).toBeLessThanOrEqual(4);

    // Clean up
    for (const r of resolveWrite) {
      r();
    }
  });

  test('file errors degrade to debug logs, never throw', async () => {
    // Arrange
    const writeFile = vi.fn().mockRejectedValue(new Error('ENOSPC'));
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps: DumpSinkDeps = {
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
    };
    const sink = new DumpSink(deps);
    const record = baseRecord();

    // Act - emit and wait for async error to be caught
    sink.emit(record);

    // Wait a bit for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Assert - should have logged the error
    expect(logger.debug).toHaveBeenCalled();
    const debugCall = logger.debug.mock.calls[0];
    if (!debugCall) throw new Error('logger.debug was not called');
    expect(debugCall[0]).toMatch(/DumpSink|failed/);
  });

  test('flush resolves immediately with nothing in flight', async () => {
    // Arrange
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const sink = new DumpSink({
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
    });

    // Act + Assert
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('flush waits for in-flight writes to settle', async () => {
    // Arrange — deferred-promise fake writeFile
    const resolveWrite: (() => void)[] = [];
    const writeFile = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => resolveWrite.push(r));
    });
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const sink = new DumpSink({
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
    });
    sink.emit(baseRecord());
    await vi.waitUntil(() => writeFile.mock.calls.length > 0, { timeout: 100 });

    let flushed = false;
    const pending = sink.flush().then(() => {
      flushed = true;
    });
    // Act — the write is still in flight
    await new Promise(resolve => setTimeout(resolve, 10));

    // Assert — flush holds until the write settles
    expect(flushed).toBe(false);
    resolveWrite[0]?.();
    await pending;
    expect(flushed).toBe(true);
  });

  test('flush drains queued-but-not-started runs (started, not dropped)', async () => {
    // Arrange — one slot: first emit runs, the other two queue
    const resolveWrite: (() => void)[] = [];
    const writeFile = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => resolveWrite.push(r));
    });
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const sink = new DumpSink({
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 1,
      maxWaiters: 10,
    });
    for (let i = 0; i < 3; i++) {
      const record = baseRecord();
      record.requestId = `req-${i}`;
      sink.emit(record);
    }
    await vi.waitUntil(() => writeFile.mock.calls.length >= 1, { timeout: 100 });

    // Act — drain; queued runs must all be written before flush resolves
    const pending = sink.flush();
    resolveWrite[0]?.();
    await vi.waitUntil(() => writeFile.mock.calls.length >= 2, { timeout: 100 });
    resolveWrite[1]?.();
    await vi.waitUntil(() => writeFile.mock.calls.length >= 3, { timeout: 100 });
    resolveWrite[2]?.();
    await pending;

    // Assert
    expect(writeFile).toHaveBeenCalledTimes(3);
  });

  test('flush after queue-full drops resolves immediately (no hang)', async () => {
    // Arrange — caps of 0: every emit is dropped, nothing ever in flight
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const sink = new DumpSink({
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
      maxConcurrent: 0,
      maxWaiters: 0,
    });
    sink.emit(baseRecord());
    await vi.waitUntil(() => logger.debug.mock.calls.length > 0, { timeout: 100 });

    // Act + Assert — dropped records cannot starve the drain
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('flush is safe to call twice while writes are pending', async () => {
    // Arrange — one in-flight write, two concurrent flushes
    const resolveWrite: (() => void)[] = [];
    const writeFile = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => resolveWrite.push(r));
    });
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const sink = new DumpSink({
      env: { PROXITOR_DUMP_BODY: '1' },
      writeFile,
      mkdir,
      logger,
    });
    sink.emit(baseRecord());
    await vi.waitUntil(() => writeFile.mock.calls.length > 0, { timeout: 100 });

    // Act
    const first = sink.flush();
    const second = sink.flush();
    resolveWrite[0]?.();

    // Assert — both settle once the write completes
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
