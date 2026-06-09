// API handlers for the panel. Returns plain objects; server.js wraps them.
import { config, instanceUrl, instanceAdminUrl } from './config.js'
import {
  readRegistry,
  removeRegistryEntry,
  listDataDirs,
  addToAllowlist,
  removeFromAllowlist,
} from './registry.js'
import {
  runningInstances,
  instanceSizes,
  provisionInstance,
  deleteInstanceFull,
  serviceActive,
} from './system.js'

// Subdomain rules: lowercase letters, digits, hyphens; must start/end alnum.
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/
const RESERVED = new Set(['www', 'api', '_', 'pocket'])

export function validName(name) {
  return NAME_RE.test(name) && !RESERVED.has(name)
}

// Build the merged instance list: registry ∪ data-dir, with size + state.
export async function listInstances() {
  const [registry, dirs, running, sizes, active] = await Promise.all([
    readRegistry(),
    listDataDirs(),
    runningInstances(),
    instanceSizes(),
    serviceActive(),
  ])

  const names = new Set([...Object.keys(registry), ...dirs])
  const instances = [...names].sort().map((name) => {
    const rec = registry[name] || {}
    return {
      name,
      url: instanceUrl(name),
      adminUrl: instanceAdminUrl(name),
      running: running.has(name),
      onDisk: dirs.includes(name),
      sizeBytes: sizes[name] || 0,
      created: rec.created || null,
      updated: rec.updated || null,
    }
  })

  return {
    serviceActive: active,
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
  // Authorize the name in the allowlist BEFORE provisioning. The patched
  // launcher-spawn plugin refuses to spawn any subdomain that is not listed,
  // so this is what makes "create" possible only through the panel.
  await addToAllowlist(name)
  const result = await provisionInstance(name)
  if (!result.ok) {
    // Provisioning failed — revoke the authorization we just granted so a
    // failed attempt does not leave a stray name the plugin would honor.
    await removeFromAllowlist(name)
    return {
      status: 502,
      body: { error: `Provision failed (HTTP ${result.httpCode})` },
    }
  }
  return { status: 200, body: { ok: true, name } }
}

export async function deleteInstance(name) {
  if (!validName(name)) {
    return { status: 400, body: { error: `Invalid name: "${name}"` } }
  }
  const result = await deleteInstanceFull(name, removeRegistryEntry)
  // Revoke authorization too, so the name cannot be re-spawned by a stray hit.
  await removeFromAllowlist(name)
  if (!result.ok) {
    return { status: 500, body: { error: 'Service failed to restart' } }
  }
  return { status: 200, body: { ok: true, name } }
}
