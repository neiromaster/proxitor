/** Sole network-egress port (spec §8, D3): the application encodes/decodes, the adapter transports. */
export type UpstreamRequest = {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type UpstreamResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<string>;
  /** B2.1: abort the in-flight fetch immediately (idempotent; no-op when settled). */
  readonly abort?: () => void;
};

export type UpstreamFetchPort = {
  fetch(request: UpstreamRequest): Promise<UpstreamResponse>;
};
