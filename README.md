# PocketHost Panel

A **lightweight, tailnet-only management panel** for a self-hosted PocketHost — **list / create / delete** instances and jump to each instance's admin UI, without pockethost.io's heavy mothership/dashboard.

<img width="950" height="359" alt="ss" src="https://github.com/user-attachments/assets/b832c79c-42c2-40cb-936b-3dbf154d7a0f" />

## How it works

The panel never fights PocketHost's state — it reads the registry (`db.json`) + filesystem and acts through PocketHost's own mechanisms:

- **List** — `db.json` + `data/` + running processes (`ps`) + size (`du`)
- **Create** — adds the name to `allowlist.json`, then fires an internal `health` request → PocketHost spawns it and the patched `auto-admin` plugin sets up the superuser
- **Delete** — stops `pockethost` → removes the `db.json` entry + `data/<name>` + allowlist entry → restarts (~6 s; needed because PocketHost caches instance URLs in memory)

**Allowlist gate:** a patch to `@pockethost/plugin-launcher-spawn` ([`deploy/plugin-patch/plugin.ts`](deploy/plugin-patch/plugin.ts)) makes it refuse any subdomain not in `allowlist.json`, so instances can only be created through the panel. The patch lives in `node_modules`, so re-apply it after any `pockethost` reinstall/upgrade.

## Run

**systemd:** copy `deploy/pockethost-panel.service.example` → `pockethost-panel.service`, fill in the `__SET_ME__` secrets, enable it.

**Docker Compose** (runs next to an existing host PocketHost, Linux only):

```bash
cp .env.example .env                                  # fill in secrets + paths
ssh-keygen -t ed25519 -N '' -f secrets/panel_ctl_ed25519
cat secrets/panel_ctl_ed25519.pub >> ~/.ssh/authorized_keys
docker compose up -d --build
```

The container runs as the **host user (uid 1000)** with `network_mode: host` + `pid: host`, and controls the host `pockethost` service over **ssh** (`PH_STOP_CMD`/`PH_START_CMD`/`PH_STATUS_CMD` → `ssh … sudo systemctl …`; no root/`privileged`). Set any to `""` to disable.

## Config (env)

| Env | Default | Description |
|-----|---------|-------------|
| `PANEL_PORT` | `8096` | Panel port |
| `PANEL_USER` / `PANEL_PASS` | `admin` / — | Basic Auth |
| `PH_HOME` | `/home/user/services/pockethost/home` | PocketHost home |
| `PH_PORT` | `8095` | PocketHost port |
| `PH_APEX_DOMAIN` | `pocket.example.com` | Apex domain |
| `PH_SERVICE` | `pockethost` | systemd unit name |
| `PH_STOP_CMD` / `PH_START_CMD` / `PH_STATUS_CMD` | `sudo systemctl …` | Service control (overridable for Docker) |

**Access:** `http://panel.pocket.example.com:8096` over tailnet (`*.pocket` wildcard → Tailscale IP), Basic Auth, port exposed via UFW on `tailscale0` only. Secrets live only in `.env` / the systemd unit — never in the repo. No dependencies beyond the **Bun** runtime.
