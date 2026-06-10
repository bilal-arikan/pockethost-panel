// Thin wrappers around the PocketBase binary: run a one-shot command, bootstrap
// a superuser, and poll an instance's health endpoint. No shell is used, so
// arguments cannot be injected.
import { config } from './config.js'

// Run a PocketBase subcommand to completion and capture its output.
async function runPb(args, opts = {}) {
  const proc = Bun.spawn([config.pbBin, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...opts,
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { code, stdout, stderr }
}

// Create (or update) the default superuser for an instance's data dir.
// PocketBase initializes the schema on first run, so this also bootstraps a
// brand-new pb_data folder. Must be called while no `serve` holds the DB.
export async function bootstrapSuperuser(pbData) {
  if (!config.adminPassword) return { ok: false, skipped: true }
  const { code, stderr } = await runPb([
    'superuser',
    'upsert',
    config.adminEmail,
    config.adminPassword,
    `--dir=${pbData}`,
  ])
  return { ok: code === 0, error: code === 0 ? null : stderr.trim() }
}

// Poll http://127.0.0.1:<port>/api/health until 200 or timeout.
export async function waitHealthy(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  const url = `http://127.0.0.1:${port}/api/health`
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await Bun.sleep(250)
  }
  return false
}
