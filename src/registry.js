// Instance registry: a small JSON file mapping instance name -> metadata.
// The on-disk pb_data folders are the source of truth for "exists"; this file
// adds creation/update timestamps and lets a name be listed before its first
// boot. PocketBase owns each instance's data; we never touch pb_data contents.
import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { config } from './config.js'

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
}

export async function readRegistry() {
  if (!existsSync(config.registryFile)) return {}
  try {
    const data = JSON.parse(await readFile(config.registryFile, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

async function writeRegistry(reg) {
  await ensureDir(dirname(config.registryFile))
  await writeFile(config.registryFile, JSON.stringify(reg, null, 2))
}

export async function upsertEntry(name, patch) {
  const reg = await readRegistry()
  const now = new Date().toISOString()
  reg[name] = { created: reg[name]?.created || now, ...reg[name], ...patch, updated: now }
  await writeRegistry(reg)
  return reg[name]
}

export async function removeEntry(name) {
  const reg = await readRegistry()
  if (reg[name]) {
    delete reg[name]
    await writeRegistry(reg)
  }
}

// Instance folders that actually exist on disk (have a pb_data dir).
export async function listDataDirs() {
  if (!existsSync(config.instancesDir)) return []
  const entries = await readdir(config.instancesDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(config.instancesDir, e.name, 'pb_data')))
    .map((e) => e.name)
}

export const pbDataDir = (name) => join(config.instancesDir, name, 'pb_data')
export const instanceDir = (name) => join(config.instancesDir, name)
