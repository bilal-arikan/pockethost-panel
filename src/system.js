// System-level helpers: process state, disk usage, provisioning, service control.
import { join } from 'path'
import { config } from './config.js'

// Run a command (args array — no shell, no injection) and capture output.
async function run(cmd) {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { code, stdout, stderr }
}

// Set of instance names that currently have a live pocketbase process.
export async function runningInstances() {
  const { stdout } = await run(['ps', '-eo', 'args'])
  const running = new Set()
  for (const line of stdout.split('\n')) {
    const m = line.match(/\/data\/([^/]+)\/pb_data/)
    if (m) running.add(m[1])
  }
  return running
}

// Map of instanceName -> size in bytes (single du pass, one level deep).
export async function instanceSizes() {
  const sizes = {}
  const { stdout } = await run(['du', '-b', '--max-depth=1', config.dataDir])
  for (const line of stdout.split('\n')) {
    const [bytes, path] = line.split('\t')
    if (!path || path === config.dataDir) continue
    const name = path.split('/').pop()
    sizes[name] = parseInt(bytes, 10) || 0
  }
  return sizes
}

// Provision (create or wake) an instance by issuing an internal health request.
// PocketHost spawns the instance on first request; the patched auto-admin
// plugin then creates the superuser.
export async function provisionInstance(name) {
  const host = `${name}.${config.apexDomain}`
  const url = `http://127.0.0.1:${config.phPort}/api/health`
  const { stdout } = await run([
    'curl', '-s', '-m', '25', '-o', '/dev/null',
    '-w', '%{http_code}', url, '-H', `Host: ${host}`,
  ])
  const httpCode = stdout.trim()
  return { ok: httpCode === '200', httpCode }
}

// Fully delete an instance. We stop the service first so the registry edit is
// not clobbered by lowdb's in-memory state, then wipe data and restart.
// Stop/start commands are configurable (config.serviceStopCmd/StartCmd); a null
// command (PH_STOP_CMD="") is treated as a no-op.
export async function deleteInstanceFull(name, removeRegistryEntry) {
  if (config.serviceStopCmd) await run(config.serviceStopCmd)
  await removeRegistryEntry(name)
  await run(['rm', '-rf', join(config.dataDir, name)])
  if (!config.serviceStartCmd) return { ok: true }
  const { code } = await run(config.serviceStartCmd)
  return { ok: code === 0 }
}

// Whether the pockethost service is currently active. With no status command
// configured (PH_STATUS_CMD=""), assume active.
export async function serviceActive() {
  if (!config.serviceStatusCmd) return true
  const { stdout } = await run(config.serviceStatusCmd)
  return stdout.trim() === 'active'
}
