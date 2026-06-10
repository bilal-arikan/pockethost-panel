// Entry point. A single Bun.serve does two jobs based on the request's Host:
//   - `<name>.<apex>`            -> reverse-proxy to that PocketBase instance
//   - the bare apex / panel.<apex> / anything else -> the management UI + API
// PocketBase instances carry their own auth; only the management side is gated
// by HTTP Basic Auth.
import { join, normalize } from 'path'
import { existsSync } from 'fs'
import { config } from './config.js'
import { isAuthorized, unauthorizedResponse } from './auth.js'
import {
  listInstances, createInstance, deleteInstance, startInstance, stopInstance,
} from './api.js'
import { isKnown, startIdleReaper, stopAll } from './supervisor.js'
import { proxyToInstance } from './proxy.js'

const PUBLIC_DIR = join(import.meta.dir, '..', 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const wrap = ({ status, body }) => json(body, status)

// Resolve the instance subdomain from a Host header, or null for management.
function resolveSubdomain(hostHeader) {
  const hostname = (hostHeader || '').split(':')[0].toLowerCase()
  const apex = config.apexDomain.toLowerCase()
  if (!hostname || hostname === apex) return null
  const suffix = '.' + apex
  if (!hostname.endsWith(suffix)) return null // raw IP / other host -> management
  const sub = hostname.slice(0, -suffix.length)
  if (!sub || sub === 'panel') return null
  return sub
}

async function serveStatic(pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname
  const filePath = normalize(join(PUBLIC_DIR, rel))
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    return new Response('Not found', { status: 404 })
  }
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  return new Response(Bun.file(filePath), {
    headers: { 'content-type': MIME[ext] || 'application/octet-stream' },
  })
}

async function handleApi(req, pathname) {
  const method = req.method
  if (pathname === '/api/instances' && method === 'GET') {
    return json(await listInstances())
  }
  if (pathname === '/api/instances' && method === 'POST') {
    const { name } = await req.json().catch(() => ({}))
    const res = await createInstance(String(name || '').trim().toLowerCase())
    return wrap(res)
  }
  const m = pathname.match(/^\/api\/instances\/([^/]+)(?:\/(start|stop))?$/)
  if (m) {
    const name = decodeURIComponent(m[1])
    const action = m[2]
    if (method === 'DELETE' && !action) return wrap(await deleteInstance(name))
    if (method === 'POST' && action === 'start') return wrap(await startInstance(name))
    if (method === 'POST' && action === 'stop') return wrap(await stopInstance(name))
  }
  return json({ error: 'Not found' }, 404)
}

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  idleTimeout: 0, // don't cut long-lived SSE (realtime) proxy streams
  async fetch(req) {
    const url = new URL(req.url)
    const sub = resolveSubdomain(req.headers.get('host'))

    // Instance request -> proxy (only for known instances; gates spawn).
    if (sub) {
      if (!(await isKnown(sub))) return new Response('No such instance', { status: 404 })
      return proxyToInstance(req, sub)
    }

    // Management side.
    if (!isAuthorized(req)) return unauthorizedResponse()
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, url.pathname)
      } catch (e) {
        return json({ error: String(e?.message || e) }, 500)
      }
    }
    return serveStatic(url.pathname)
  },
})

startIdleReaper()

async function shutdown() {
  try { await stopAll() } catch {}
  server.stop(true)
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log(
  `PocketBaseForge on http://${config.host}:${config.port} ` +
  `(apex: ${config.apexDomain}) — panel + per-subdomain proxy`,
)
