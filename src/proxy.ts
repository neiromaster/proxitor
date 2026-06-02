import { createServer } from 'node:http'
import type { ProxyConfig } from './config.js'

export function createProxyServer(_config: ProxyConfig) {
  const server = createServer((_req, res) => {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not implemented yet' }))
  })

  return server
}
