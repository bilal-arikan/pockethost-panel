// Reverse proxy: forward a request to a running instance's loopback port and
// stream the response back. Streaming is preserved in both directions, so
// PocketBase's realtime (SSE) and file up/downloads work transparently.
import { ensureRunning } from './supervisor.js'

// Hop-by-hop headers must not be forwarded.
const HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

export async function proxyToInstance(req, name) {
  let port
  try {
    port = await ensureRunning(name)
  } catch (e) {
    return new Response(`Instance unavailable: ${e.message}`, { status: 502 })
  }

  const url = new URL(req.url)
  const target = `http://127.0.0.1:${port}${url.pathname}${url.search}`

  const headers = new Headers(req.headers)
  for (const h of HOP) headers.delete(h)
  // Ask upstream for identity encoding: Bun's fetch transparently decompresses
  // the body but leaves the Content-Encoding header, which would make clients
  // try to gunzip already-plain bytes. Removing it sidesteps the mismatch.
  headers.delete('accept-encoding')

  const init = { method: req.method, headers, redirect: 'manual' }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body
    init.duplex = 'half'
  }

  let resp
  try {
    resp = await fetch(target, init)
  } catch (e) {
    return new Response(`Bad gateway: ${e.message}`, { status: 502 })
  }

  const outHeaders = new Headers(resp.headers)
  for (const h of HOP) outHeaders.delete(h)
  // Body may have been decompressed by fetch; drop stale encoding/length so the
  // client reads it as identity (length is recomputed from the stream).
  outHeaders.delete('content-encoding')
  outHeaders.delete('content-length')
  return new Response(resp.body, { status: resp.status, headers: outHeaders })
}
