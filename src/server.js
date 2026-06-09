// Entry point: Bun.serve HTTP server. Serves the static UI and the JSON API,
// guarded by HTTP Basic Auth.
import { join, normalize } from 'path'
import { existsSync } from 'fs'
import { config } from './config.js'
import { isAuthorized, unauthorizedResponse } from './auth.js'
import { listInstances, createInstance, deleteInstance } from './api.js'

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

async function serveStatic(pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname
  // Prevent path traversal: normalized path must stay inside PUBLIC_DIR.
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
    const { status, body } = await createInstance(String(name || '').trim())
    return json(body, status)
  }

  const delMatch = pathname.match(/^\/api\/instances\/([^/]+)$/)
  if (delMatch && method === 'DELETE') {
    const { status, body } = await deleteInstance(decodeURIComponent(delMatch[1]))
    return json(body, status)
  }

  return json({ error: 'Not found' }, 404)
}

Bun.serve({
  port: config.panelPort,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url)

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

console.log(`PocketHost panel listening on http://0.0.0.0:${config.panelPort}`)
