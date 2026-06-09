# PocketHost Panel

A **lightweight, single-user (tailnet-only) management panel** for a self-hosted PocketHost on `example-vps`.

No need for pockethost.io's heavy "mothership + dashboard" architecture â€” **list / create / delete** instances from one place and jump to each instance's admin UI with a single click.

<img width="950" height="359" alt="ss" src="https://github.com/user-attachments/assets/b832c79c-42c2-40cb-936b-3dbf154d7a0f" />

## Architecture

To avoid conflicting with PocketHost's internal state, the panel reads its **registry (`db.json`) and filesystem**, and performs operations through PocketHost's own mechanisms:

| Action | How it works |
|--------|--------------|
| **List** | Merges `db.json` + the `data/` folder + running `pocketbase` processes (`ps`) + size (`du`) |
| **Create** | The name is first added to `allowlist.json` â†’ an internal `health` request (`curl -H "Host: <name>.apex"`) â†’ PocketHost spawns the instance and the patched `auto-admin` plugin sets up the superuser |
| **Delete** | The `pockethost` service is stopped â†’ the `db.json` entry is removed â†’ `data/<name>` is deleted â†’ the name is removed from `allowlist.json` â†’ the service is restarted (~6 s) |

> **Why a restart on delete?** PocketHost caches instance URLs in memory. Deleting the process/files externally conflicts with that cache. Briefly stopping the service is the most reliable way to safely edit the registry and start clean. For tailnet-only personal use, a ~6 s interruption is acceptable.

## Panel-only creation (allowlist mode)

Stock PocketHost auto-creates an instance the first time it sees **any** `<name>.pocket.example.com` request â€” meaning typing a random subdomain in the browser spawns a new database. For a single-user personal setup this is undesirable.

To prevent it, an **allowlist gate** was added to the `@pockethost/plugin-launcher-spawn` plugin (patch: [`deploy/plugin-patch/plugin.ts`](deploy/plugin-patch/plugin.ts)):

- On every request the plugin reads `plugin-launcher-spawn/allowlist.json` **fresh from disk**.
- If the subdomain is neither in the registry (`db.json`) nor in the allowlist â†’ no instance is created and the core returns `404 not found`. **No spawn, no db entry, no data folder.**
- On "Create", the panel adds the name to the allowlist **first**, then issues the provision request. This makes creation possible only through the panel. Because the allowlist is read from disk, no `pockethost` restart is needed when it changes.

> âš ï¸ **The patch lives inside node_modules.** If `bunx pockethost` reinstalls (`bun install` / version upgrade), the patch may be wiped. To re-apply it:
> ```bash
> scp deploy/plugin-patch/plugin.ts \
>   your-vps:/home/user/services/pockethost/node_modules/@pockethost/plugin-launcher-spawn/src/plugin.ts
> sudo systemctl restart pockethost
> ```
> A backup of the original file is kept on the VPS as `plugin.ts.orig` and in this repo as [`deploy/plugin-patch/plugin.original.ts`](deploy/plugin-patch/plugin.original.ts).

## Project layout

```
src/
  config.js     # env-based configuration
  registry.js   # db.json read/write + data dir scanning + allowlist
  system.js     # ps / du / curl provision / systemctl
  auth.js       # HTTP Basic Auth
  api.js        # business logic (list / create / delete)
  server.js     # Bun.serve entry point
public/
  index.html app.js style.css   # UI (vanilla JS, no build step)
deploy/
  pockethost-panel.service.example   # systemd unit template (fill in secrets)
  plugin-patch/                      # launcher-spawn allowlist patch + original backup
Dockerfile            # Bun image (procps/coreutils/curl/openssh-client)
docker-compose.yml    # run the panel alongside an existing host PocketHost
.env.example          # compose env template (copy to .env)
```

## Running (VPS)

```bash
sudo systemctl status pockethost-panel
sudo systemctl restart pockethost-panel
tail -f /home/user/services/pockethost-panel/panel.log
```

## Running (Docker Compose)

The panel can also run as a container next to an **existing host PocketHost** (Linux host only). It runs as the **host user (uid 1000)** so the registry files it writes stay owned by that user, shares the host network and PID namespace, and controls the host `pockethost` service over **ssh** (no root / no `privileged`).

```bash
cp .env.example .env                       # fill in PANEL_PASS, paths, key path
# Create a control key whose pubkey is in the host user's authorized_keys and
# whose user has passwordless `sudo systemctl`:
ssh-keygen -t ed25519 -N '' -f secrets/panel_ctl_ed25519
cat secrets/panel_ctl_ed25519.pub >> ~/.ssh/authorized_keys
docker compose up -d --build
docker compose logs -f
```

| Compose setting | Why |
|-----------------|-----|
| `user: "1000:1000"` | Write `db.json` / `allowlist.json` as the host owner so PocketHost can rewrite them |
| `network_mode: host` | Bind `PANEL_PORT`, reach `127.0.0.1:PH_PORT` and the host `sshd` |
| `pid: host` | `ps` can see the host `pocketbase` processes |
| volume `${PH_HOME}:${PH_HOME}` | Mount PocketHost home **1:1** so config paths resolve identically |
| volume `${PH_CTL_KEY}:/keys/host_ctl:ro` | SSH key used to run `sudo systemctl` on the host |

> **Service control is configurable.** `PH_STOP_CMD` / `PH_START_CMD` / `PH_STATUS_CMD` override how the panel controls PocketHost. The compose `.env` points them at the host systemd over ssh (`ssh … sudo systemctl …`); set any to `""` to disable that step. On a plain systemd host (no Docker) the defaults are `sudo systemctl …`, so nothing changes.

## Access

- **URL:** `http://panel.pocket.example.com:8096` (over tailnet; `*.pocket` wildcard â†’ Tailscale IP)
- **Login (Basic Auth):** `admin` / `<PANEL_PASS>` â€” the real password is kept only in the VPS systemd unit (never in the repo).
- Port `8096`, exposed via UFW only on the `tailscale0` interface.

## Configuration (env, in the systemd unit)

| Env | Default | Description |
|-----|---------|-------------|
| `PANEL_PORT` | `8096` | Panel port |
| `PH_HOME` | `/home/user/services/pockethost/home` | PocketHost home |
| `PH_PORT` | `8095` | PocketHost port |
| `PH_APEX_DOMAIN` | `pocket.example.com` | Apex domain |
| `PH_SERVICE` | `pockethost` | systemd unit name |
| `PANEL_USER` / `PANEL_PASS` | `admin` / â€” | Basic Auth credentials |
| `PH_STOP_CMD` | `sudo systemctl stop <svc>` | Command to stop PocketHost (delete flow); `""` to disable |
| `PH_START_CMD` | `sudo systemctl start <svc>` | Command to start PocketHost; `""` to disable |
| `PH_STATUS_CMD` | `systemctl is-active <svc>` | Command reporting service health (`active`); `""` ⇒ assume active |

> **Setup:** Copy `deploy/pockethost-panel.service.example` to the VPS as `pockethost-panel.service` and replace the `__SET_ME__` passwords with real values. The real `.service` file is in `.gitignore` â€” passwords never enter the repo.

## Notes

- No dependencies; just the **Bun** runtime + Node builtins.
- The panel is a separate service; it is unaffected by `pockethost` restarts.
- "registry-only" badge: a ghost entry present in `db.json` but with no folder on disk (can be deleted from the panel).
