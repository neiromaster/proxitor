# @proxitor/plugin-api

Published plugin contract for proxitor v1. Plugins transform a `CanonicalRequest`
(IR) and observe/transform a `CanonicalEvent` stream; they are blind to
providers, wire formats and transport (spec D9).

## Mutations channels (and only these)

1. The typed IR: `CanonicalRequest` (mutate and return from `onRequest`).
2. `req.outboundHeaders` — upstream request headers. Protected (ignored on
   conflict): `authorization`, `x-api-key`, `host`, `content-length`, and all
   `provider.headers`.
3. Format-reserved `$proxitor.` keys inside `req.extensions[format]`. Declare
   them in `reservedKeys`; config-time validation matches the provider's
   wireFormat. Reserved keys per format:

   | format              | reserved keys                                                                   |
   | ------------------- | ------------------------------------------------------------------------------- |
   | `openai-chat`       | `$proxitor.provider`, `$proxitor.models`, `$proxitor.route`, `$proxitor.transforms` |
   | `anthropic-messages` | — (none in v1)                                                                  |

## ShortCircuit

`{ shortCircuit: true, status, headers? }` plus **exactly one** of `error`
(CanonicalError, encoded to the client's wire-error format) or `events`
(CanonicalEvent[], encoded to the client's inbound format — works for both
streaming and non-streaming clients). Raw-body mocks are not supported.

## definePlugin

```ts
import { definePlugin } from '@proxitor/plugin-api';
import { z } from 'zod';

export default definePlugin(z.object({ ttl: z.enum(['5m', '1h']) }), {
  name: 'cache-control',
  onRequest(ctx, req) { /* mutate req, return it */ return req; },
});
```

zod is a peer dependency (`^4`).