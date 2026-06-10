// Central configuration. Every value is overridable via environment variables.
// This build manages PocketBase binaries directly (no PocketHost), so it is
// fully self-contained and portable (runs the same on Windows/macOS/Linux,
// natively or in a single container).
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || '/data'

export const config = {
  // Port the panel + reverse proxy listen on (single public port).
  port: parseInt(process.env.PORT || '8090', 10),
  host: process.env.HOST || '0.0.0.0',

  // Apex domain used for subdomain routing. `<name>.<apex>` -> instance,
  // the bare apex (or `panel.<apex>`) -> management UI.
  // Default `localhost`: browsers resolve `*.localhost` to 127.0.0.1, so the
  // panel works with zero DNS setup. Set to a real wildcard domain in prod.
  apexDomain: process.env.APEX_DOMAIN || 'localhost',

  // Storage layout (lives on a persistent volume).
  dataDir: DATA_DIR,
  instancesDir: process.env.INSTANCES_DIR || join(DATA_DIR, 'instances'),
  registryFile: process.env.REGISTRY_FILE || join(DATA_DIR, 'registry.json'),

  // PocketBase binary (in PATH inside the container; override for local runs).
  pbBin: process.env.PB_BIN || 'pocketbase',

  // Internal port range for spawned PocketBase processes (loopback only).
  portBase: parseInt(process.env.INSTANCE_PORT_BASE || '9001', 10),
  portMax: parseInt(process.env.INSTANCE_PORT_MAX || '9999', 10),

  // Idle shutdown: stop an instance after this many ms with no requests.
  // 0 disables idle reaping (instances stay up once started).
  idleTimeoutMs: parseInt(process.env.IDLE_TIMEOUT_MS || '0', 10),

  // Seconds to wait for a freshly spawned instance to become healthy.
  startTimeoutMs: parseInt(process.env.START_TIMEOUT_MS || '15000', 10),

  // Default superuser created for every new instance.
  adminEmail: process.env.PB_ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.PB_ADMIN_PASSWORD || '',

  // Basic-auth credentials guarding the management UI/API (not the instances —
  // each PocketBase has its own auth).
  panelUser: process.env.PANEL_USER || 'admin',
  panelPass: process.env.PANEL_PASS || 'admin',
}

// External URL of an instance (what a browser hits).
export const instanceUrl = (name) => {
  const p = config.port === 80 ? '' : `:${config.port}`
  return `http://${name}.${config.apexDomain}${p}`
}

export const instanceAdminUrl = (name) => `${instanceUrl(name)}/_/`
