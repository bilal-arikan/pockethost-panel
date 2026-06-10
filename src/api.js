// Management API: list / create / delete / start / stop instances.
// Returns plain objects; server.js wraps them in HTTP responses.
import { rm, stat, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { config, instanceUrl, instanceAdminUrl } from './config.js'
import {
  upsertEntry, removeEntry, readRegistry, instanceDir, pbDataDir,
} from './registry.js'
import {
  ensureRunning, stop, isRunning, runningInfo, allKnownNames,
} from './supervisor.js'
import { bootstrapSuperuser } from './pocketbase.js'

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/
const RESERVED = new Set(['www', 'api', 'panel', '_', 'admin'])

export function validName(name) {
  return NAME_RE.test(name) && !RESERVED.has(name)
}

// Recursive directory size in bytes (cross-platform; no `du` dependency).
async function dirSize(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const p = join(dir, e.name)
    try {
      if (e.isDirectory()) total += await dirSize(p)
      else if (e.isFile()) total += (await stat(p)).size
    } catch {
      // entry vanished mid-walk — ignore
    }
  }
  return total
}

export async function listInstances() {
  const [reg, names] = await Promise.all([readRegistry(), allKnownNames()])
  const instances = await Promise.all(
    [...names].sort().map(async (name) => {
      const onDisk = existsSync(pbDataDir(name))
      const rec = reg[name] || {}
      return {
        name,
        url: instanceUrl(name),
        adminUrl: instanceAdminUrl(name),
        running: isRunning(name),
        onDisk,
        port: runningInfo(name)?.port || null,
        sizeBytes: onDisk ? await dirSize(instanceDir(name)) : 0,
        created: rec.created || null,
        updated: rec.updated || null,
      }
    }),
  )
  return {
    serviceActive: true,
    apexDomain: config.apexDomain,
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
    instances,
  }
}

export async function createInstance(name) {
  if (!validName(name)) {
    return { status: 400, body: { error: `Invalid name: "${name}"` } }
  }
  if (existsSync(pbDataDir(name))) {
    return { status: 409, body: { error: `Instance "${name}" already exists` } }
  }
  await upsertEntry(name, {})
  // Initialize schema + default superuser before serving (no DB contention).
  const boot = await bootstrapSuperuser(pbDataDir(name))
  if (boot.ok === false && !boot.skipped) {
    await removeEntry(name)
    await rm(instanceDir(name), { recursive: true, force: true })
    return { status: 500, body: { error: `Superuser setup failed: ${boot.error}` } }
  }
  try {
    await ensureRunning(name)
  } catch (e) {
    return { status: 502, body: { error: `Started but unhealthy: ${e.message}` } }
  }
  return { status: 200, body: { ok: true, name } }
}

export async function deleteInstance(name) {
  if (!validName(name)) {
    return { status: 400, body: { error: `Invalid name: "${name}"` } }
  }
  await stop(name)
  await removeEntry(name)
  await rm(instanceDir(name), { recursive: true, force: true })
  return { status: 200, body: { ok: true, name } }
}

export async function startInstance(name) {
  if (!validName(name)) return { status: 400, body: { error: 'Invalid name' } }
  if (!existsSync(pbDataDir(name))) {
    return { status: 404, body: { error: 'No such instance' } }
  }
  try {
    const port = await ensureRunning(name)
    return { status: 200, body: { ok: true, name, port } }
  } catch (e) {
    return { status: 502, body: { error: e.message } }
  }
}

export async function stopInstance(name) {
  if (!validName(name)) return { status: 400, body: { error: 'Invalid name' } }
  const was = await stop(name)
  return { status: 200, body: { ok: true, name, wasRunning: was } }
}
