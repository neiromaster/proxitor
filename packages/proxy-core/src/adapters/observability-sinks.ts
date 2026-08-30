import { type InspectColor, styleText } from 'node:util';
import type { LoggerPort } from '@proxitor/plugin-api';
import type { ObservationRecord, ObservationSink } from '../application/observability.js';

const STYLE: Record<string, InspectColor> = {
  HIT: 'green',
  PARTIAL: 'yellow',
  MISS: 'red',
  COLD: 'dim',
  NOUSAGE: 'gray',
};

function withReq(reqId: string, msg: string): string {
  return `[${reqId}] ${msg}`;
}

/** Formats an observation line matching the legacy order:
 *  label [pct] read N write N in N provider model [requestType]
 * Prefixed with [requestId]. Empty model is omitted for log-parsing hygiene.
 */
export function formatObservationLine(
  record: ObservationRecord,
  useColor = false,
): string {
  const { label, hitPct } = record.outcome;
  const parts: string[] = [];

  // Colorize label if enabled
  const coloredLabel = useColor ? styleText(STYLE[label] ?? 'dim', label) : label;
  parts.push(coloredLabel);

  // HIT/PARTIAL append the percentage
  if (label === 'HIT' || label === 'PARTIAL') {
    parts.push(`${hitPct.toFixed(0)}%`);
  }

  // Cache metrics
  if (record.usage.cacheRead > 0) {
    parts.push(`read ${record.usage.cacheRead}`);
  }
  if (record.usage.cacheCreate > 0) {
    parts.push(`write ${record.usage.cacheCreate}`);
  }

  // Input tokens if present
  if (record.usage.present) {
    parts.push(`in ${record.usage.inputTokens}`);
  }

  // Provider if present
  if (record.provider !== undefined) {
    parts.push(`provider=${record.provider}`);
  }

  // Model (omit empty for log-parsing hygiene)
  if (record.model) {
    parts.push(record.model);
  }

  // Request type
  parts.push(`[${record.requestType}]`);

  return withReq(record.requestId, parts.join('  '));
}

/** Sink that emits one-line summaries to a logger. */
export class LiveLineSink implements ObservationSink {
  private readonly useColor: () => boolean;
  private readonly info: (line: string) => void;

  constructor(deps: { info: (line: string) => void; useColor?: () => boolean }) {
    this.useColor = deps.useColor ?? (() => process.stdout.isTTY === true);
    this.info = deps.info;
  }

  emit(record: ObservationRecord): void {
    this.info(formatObservationLine(record, this.useColor()));
  }
}

/** One verbose line per completed request (logging.verbose): requestId, model,
 * provider, status, and the cache verdict as recorded. Fixed `key=value` shape
 * so it is greppable and distinct from the LiveLineSink summary format.
 */
export function formatVerboseLine(record: ObservationRecord): string {
  const model = record.model.length > 0 ? record.model : '-';
  const provider = record.provider ?? '-';
  return `[${record.requestId}] model=${model} provider=${provider} status=${record.status} cache=${record.outcome.label}`;
}

/** Sink that emits one verbose line per completed request. */
export class VerboseLineSink implements ObservationSink {
  private readonly info: (line: string) => void;

  constructor(deps: { info: (line: string) => void }) {
    this.info = deps.info;
  }

  emit(record: ObservationRecord): void {
    this.info(formatVerboseLine(record));
  }
}

export type DumpSinkDeps = {
  env: Record<string, string | undefined>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  logger: LoggerPort;
  maxConcurrent?: number;
  maxWaiters?: number;
  now?: () => Date;
};

/** Sink that writes request+response dumps to JSON files.
 * Fire-and-forget with concurrency caps; file errors degrade to debug logs.
 */
export class DumpSink implements ObservationSink {
  private inflight = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly maxWaiters: number;
  private readonly enabled: () => boolean;
  private readonly dumpDir: string;
  private readonly writeFile: (path: string, data: string) => Promise<void>;
  private readonly mkdir: (path: string) => Promise<void>;
  private readonly logger: LoggerPort;
  private readonly now: () => Date;

  constructor(deps: DumpSinkDeps) {
    this.maxConcurrent = deps.maxConcurrent ?? 16;
    this.maxWaiters = deps.maxWaiters ?? 256;
    this.enabled = () => deps.env.PROXITOR_DUMP_BODY === '1';
    this.dumpDir =
      deps.env.PROXITOR_DUMP_DIR ?? `${process.env.HOME ?? '/tmp'}/.cache/proxitor/dumps`;
    this.writeFile = deps.writeFile;
    this.mkdir = deps.mkdir;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => new Date());
  }

  emit(record: ObservationRecord): void {
    // Gate per-call so flag flip stays consistent
    if (!this.enabled()) return;

    const run = (): void => {
      this.inflight += 1;
      void this.dump(record)
        .catch(err => {
          this.logger.debug('DumpSink failed', {
            requestId: record.requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          this.inflight -= 1;
          const next = this.waiters.shift();
          if (next) next();
        });
    };

    if (this.inflight < this.maxConcurrent) {
      run();
    } else if (this.waiters.length < this.maxWaiters) {
      this.waiters.push(run);
    } else {
      // Queue full — drop the dump
      this.logger.debug('DumpSink queue full — dump dropped', {
        requestId: record.requestId,
      });
    }
  }

  private async dump(record: ObservationRecord): Promise<void> {
    const filename = this.filePath(record.requestId, record.model);
    const dir = this.dirname(filename);

    await this.mkdir(dir);

    const content = {
      ts: this.now().toISOString(),
      request: record.requestBody ?? null,
      response: {
        status: record.status,
        label: record.outcome.label,
        requestType: record.requestType,
        model: record.model,
        sessionId: record.sessionId ?? null,
        provider: record.provider ?? null,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        cacheRead: record.usage.cacheRead,
        cacheCreate: record.usage.cacheCreate,
        hitPct: record.outcome.hitPct,
      },
    };

    await this.writeFile(filename, `${JSON.stringify(content, null, 2)}\n`);
  }

  private dirname(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.substring(0, lastSlash) : '.';
  }

  private filePath(requestId: string, model: string | undefined): string {
    const ts = this.tsSlug();
    const safeId = this.safeName(requestId);
    const safeModel = model && model.length > 0 ? this.safeName(model) : '';
    const parts = [ts, safeModel, safeId].filter(Boolean);
    return `${this.dumpDir}/${parts.join('_')}.json`;
  }

  private safeName(name: string): string {
    return name.replace(/[^A-Za-z0-9_-]/g, '_');
  }

  private tsSlug(): string {
    const d = this.now();
    const pad = (n: number, len = 2): string => `${n}`.padStart(len, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
  }
}
