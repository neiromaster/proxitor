---
"proxitor": minor
---

Add live config hot-reload: while the proxy runs, saving its config file is picked
up automatically (polled via `fs.watchFile`) and applied to subsequent requests —
no restart needed. Invalid edits keep the last valid config and log a clear error;
the process never crashes. Tune cache settings (`cacheControl`, TTL,
`normalizeVolatileSystem`, `modelOverrides`, provider routing) in one terminal and
watch the effect on cache-hit logs in real time.
