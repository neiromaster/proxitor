/**
 * Request-time routing failure (spec §5.2): carries the HTTP status the
 * application layer maps onto the client's inbound wire-error format.
 */
export class RoutingError extends Error {
  readonly status: 400 | 404 | 501;

  constructor(message: string, status: 400 | 404 | 501, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RoutingError';
    this.status = status;
  }
}

/**
 * Config-shape failure at routing-table build (load) time: fail-loud (§10).
 * Never reaches a client — it aborts config load / keeps the last valid table.
 */
export class RoutingConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RoutingConfigError';
  }
}
