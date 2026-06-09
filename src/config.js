// Central configuration for the PocketHost management panel.
// Every value can be overridden via environment variables (see the systemd unit).
import { join } from 'path'

const PH_HOME = process.env.PH_HOME || '/home/user/services/pockethost/home'

const PH_SERVICE = process.env.PH_SERVICE || 'pockethost'

// Resolve a service-control command from an env override into an argv array.
// - undefined  -> use the provided default (host systemd behaviour)
// - ""         -> no-op (command is skipped; useful where the panel cannot or
//                 must not control the service, e.g. a managed sidecar)
// - "a b c"    -> split on whitespace into argv (no shell, no injection)
function resolveCmd(envValue, fallback) {
  if (envValue === undefined) return fallback
  const trimmed = envValue.trim()
  return trimmed === '' ? null : trimmed.split(/\s+/)
}

export const config = {
  // Port the panel itself listens on (tailnet-only via UFW).
  panelPort: parseInt(process.env.PANEL_PORT || '8096', 10),

  // PocketHost layout.
  phHome: PH_HOME,
  dataDir: process.env.PH_DATA_DIR || join(PH_HOME, 'data'),
  dbJson:
    process.env.PH_DB_JSON ||
    join(PH_HOME, 'plugin-launcher-spawn', 'db.json'),
  // Allowlist consumed by the patched launcher-spawn plugin. Only subdomains
  // listed here may be provisioned â€” the panel appends a name before creating.
  allowlistJson:
    process.env.PH_ALLOWLIST_JSON ||
    join(PH_HOME, 'plugin-launcher-spawn', 'allowlist.json'),
  phPort: parseInt(process.env.PH_PORT || '8095', 10),
  apexDomain: process.env.PH_APEX_DOMAIN || 'pocket.example.com',
  phService: PH_SERVICE,

  // Service-control commands. Default to host systemd; override via env for
  // containerized deployments (e.g. nsenter into the host, or "" to disable).
  serviceStopCmd: resolveCmd(process.env.PH_STOP_CMD, ['sudo', 'systemctl', 'stop', PH_SERVICE]),
  serviceStartCmd: resolveCmd(process.env.PH_START_CMD, ['sudo', 'systemctl', 'start', PH_SERVICE]),
  serviceStatusCmd: resolveCmd(process.env.PH_STATUS_CMD, ['systemctl', 'is-active', PH_SERVICE]),

  // Per-instance default admin (set by the patched auto-admin plugin).
  adminEmail: process.env.PH_AUTO_ADMIN_LOGIN || 'admin@example.com',
  adminPassword: process.env.PH_AUTO_ADMIN_PASSWORD || '',

  // Basic-auth credentials guarding the panel.
  panelUser: process.env.PANEL_USER || 'admin',
  panelPass: process.env.PANEL_PASS || 'admin',
}

// Public (browser-facing) URL of an instance over tailnet.
export const instanceUrl = (name) =>
  `http://${name}.${config.apexDomain}:${config.phPort}`

export const instanceAdminUrl = (name) => `${instanceUrl(name)}/_/`
