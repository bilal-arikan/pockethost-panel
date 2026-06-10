// Process supervisor: one PocketBase child process per instance, each bound to
// a private loopback port. Instances start lazily on first request (and can be
// reaped when idle), mirroring PocketHost's on-demand model — but here we own
// the processes directly, so there is no orchestrator and no global restart.
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { config } from './config.js'
import { pbDataDir, instanceDir, readRegistry, listDataDirs } from './registry.js'
import { waitHealthy } from './pocketbase.js'

// name -> { proc, port, startedAt, lastAccess }
const running = new Map()
// name -> Promise<port> while a start is in flight (dedupes concurrent starts)
const starting = new Map()
const usedPorts = new Set()

function allocatePort() {
  for (let p = config.portBase; p <= config.portMax; p++) {
    if (!usedPorts.has(p)) {
      usedPorts.add(p)
      return p
    }
  }
  throw new Error('No free instance port available')
}

// Is this a known instance (registered or already on disk)? Only known names
// may be started — this is the gate that stops arbitrary subdomains spawning.
export async function isKnown(name) {
  if (running.has(name) || existsSync(pbDataDir(name))) return true
  const reg = await readRegistry()
  return !!reg[name]
}

export function isRunning(name) {
  return running.has(name)
}

export function runningInfo(name) {
  return running.get(name) || null
}

// Spawn a PocketBase process for `name` and wait until it is healthy.
async function start(name) {
  const dir = pbDataDir(name)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const port = allocatePort()
  const proc = Bun.spawn(
    [config.pbBin, 'serve', `--http=127.0.0.1:${port}`, `--dir=${dir}`],
    { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
  )

  const entry = { proc, port, startedAt: Date.now(), lastAccess: Date.now() }
  running.set(name, entry)

  // If the process dies, free its slot.
  proc.exited.then(() => {
    if (running.get(name) === entry) running.delete(name)
    usedPorts.delete(port)
  })

  const healthy = await waitHealthy(port, config.startTimeoutMs)
  if (!healthy) {
    try { proc.kill() } catch {}
    running.delete(name)
    usedPorts.delete(port)
    throw new Error(`Instance "${name}" failed to become healthy`)
  }
  return port
}

// Ensure `name` is running; return its loopback port. Concurrency-safe.
export async function ensureRunning(name) {
  const cur = running.get(name)
  if (cur) {
    cur.lastAccess = Date.now()
    return cur.port
  }
  if (starting.has(name)) return starting.get(name)

  const p = start(name).finally(() => starting.delete(name))
  starting.set(name, p)
  return p
}

export function touch(name) {
  const e = running.get(name)
  if (e) e.lastAccess = Date.now()
}

// Stop a running instance (graceful kill). Returns true if it was running.
export async function stop(name) {
  const e = running.get(name)
  if (!e) return false
  try { e.proc.kill() } catch {}
  try { await e.proc.exited } catch {}
  running.delete(name)
  usedPorts.delete(e.port)
  return true
}

// Idle reaper: stop instances with no traffic for idleTimeoutMs.
export function startIdleReaper() {
  if (config.idleTimeoutMs <= 0) return
  setInterval(() => {
    const now = Date.now()
    for (const [name, e] of running) {
      if (now - e.lastAccess > config.idleTimeoutMs) stop(name)
    }
  }, Math.min(config.idleTimeoutMs, 30000)).unref?.()
}

// Stop everything (used on shutdown).
export async function stopAll() {
  await Promise.all([...running.keys()].map((n) => stop(n)))
}

// Names currently running (for the list view).
export function runningNames() {
  return new Set(running.keys())
}

// Convenience for the list view: all known names from registry + disk.
export async function allKnownNames() {
  const [reg, dirs] = await Promise.all([readRegistry(), listDataDirs()])
  return new Set([...Object.keys(reg), ...dirs, ...running.keys()])
}
