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
};

export type UpstreamFetchPort = {
  fetch(request: UpstreamRequest): Promise<UpstreamResponse>;
};
