import type { CanonicalError, CanonicalEvent } from './canonical/events.js';
import type { CanonicalRequest } from './canonical/request.js';
import type { ClockPort, LoggerPort, RandomPort } from './ports.js';
import type { WireFormat } from './wire-format.js';

/**
 * Plugin-initiated response without hitting upstream (spec §7).
 * `error` XOR `events`: error is encoded to the client's wire-error format,
 * events are encoded to the client's inbound format (format-agnostic mock).
 * Raw-body mocks are intentionally NOT supported (D9).
 */
export type ShortCircuit = {
  shortCircuit: true;
  status: number;
  headers?: Record<string, string>;
  error?: CanonicalError;
  events?: CanonicalEvent[];
} & (
  | { error: CanonicalError; events?: never }
  | { events?: CanonicalEvent[]; error?: never }
);

export type PluginContext<TConfig = unknown> = {
  requestId: string;
  logger: LoggerPort;
  clock: ClockPort;
  random: RandomPort;
  config: TConfig;
};

export type ProxyPlugin<TConfig = unknown> = {
  /** Unique instance id: dedup across config layers. */
  name: string;
  validateConfig?(raw: unknown): TConfig;
  /**
   * Declares which format-reserved `$proxitor.` keys this plugin writes (spec §4.3).
   * Config-time validation matches these against the provider's wireFormat.
   */
  reservedKeys?: Partial<Record<WireFormat, readonly string[]>>;
  onRequest?(
    ctx: PluginContext<TConfig>,
    req: CanonicalRequest,
  ): Promise<CanonicalRequest | ShortCircuit> | CanonicalRequest | ShortCircuit;
  onEvent?(ctx: PluginContext<TConfig>, event: CanonicalEvent): Promise<void> | void;
  transformStream?(
    ctx: PluginContext<TConfig>,
    events: AsyncIterable<CanonicalEvent>,
  ): AsyncIterable<CanonicalEvent>;
  onError?(
    ctx: PluginContext<TConfig>,
    error: CanonicalError,
  ): Promise<CanonicalError> | CanonicalError;
};
