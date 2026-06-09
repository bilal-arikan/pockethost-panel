// Minimal HTTP Basic Auth. The panel is already tailnet-only; this is a
// second layer guarding destructive actions (create / delete).
import { config } from './config.js'

export function isAuthorized(req) {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Basic ')) return false
  try {
    const decoded = atob(header.slice('Basic '.length))
    const idx = decoded.indexOf(':')
    const user = decoded.slice(0, idx)
    const pass = decoded.slice(idx + 1)
    return user === config.panelUser && pass === config.panelPass
  } catch {
    return false
  }
}

export function unauthorizedResponse() {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="PocketHost Panel"' },
  })
}
