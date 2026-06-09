// Reads and mutates PocketHost's lowdb registry (db.json) and scans the data dir.
import { readFile, writeFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { config } from './config.js'

// Parse the launcher-spawn db.json registry into a { name: record } map.
export async function readRegistry() {
  if (!existsSync(config.dbJson)) return {}
  try {
    const raw = await readFile(config.dbJson, 'utf8')
    const data = JSON.parse(raw)
    return data.instances || {}
  } catch {
    return {}
  }
}

// Remove a single instance from db.json.
// IMPORTANT: only call this while the pockethost service is stopped, otherwise
// the in-memory lowdb state will overwrite our change on the next write.
export async function removeRegistryEntry(name) {
  if (!existsSync(config.dbJson)) return
  const raw = await readFile(config.dbJson, 'utf8')
  const data = JSON.parse(raw)
  if (data.instances && data.instances[name]) {
    delete data.instances[name]
    await writeFile(config.dbJson, JSON.stringify(data, null, 2))
  }
}

// --- Allowlist (allowlist.json) -------------------------------------------
// The patched launcher-spawn plugin only provisions subdomains present here.
// The panel is the sole writer: it adds a name before provisioning and removes
// it on delete. The plugin reads the file fresh per request, so no pockethost
// restart is needed when this changes.

// Read the allowlist as an array of subdomain strings.
export async function readAllowlist() {
  if (!existsSync(config.allowlistJson)) return []
  try {
    const raw = await readFile(config.allowlistJson, 'utf8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeAllowlist(list) {
  const unique = [...new Set(list)].sort()
  await writeFile(config.allowlistJson, JSON.stringify(unique, null, 2))
}

// Add a subdomain to the allowlist (idempotent).
export async function addToAllowlist(name) {
  const list = await readAllowlist()
  if (!list.includes(name)) await writeAllowlist([...list, name])
}

// Remove a subdomain from the allowlist (idempotent).
export async function removeFromAllowlist(name) {
  const list = await readAllowlist()
  if (list.includes(name)) await writeAllowlist(list.filter((n) => n !== name))
}

// List instance folders that actually exist on disk.
export async function listDataDirs() {
  if (!existsSync(config.dataDir)) return []
  const entries = await readdir(config.dataDir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}
