# PocketBaseForge

A **self-contained, multi-tenant PocketBase host**. One small Bun service is both a **management panel** and a **reverse proxy**: it spawns one PocketBase process per instance and routes `<name>.<apex>` to it. No PocketHost, no systemd, no host coupling — it runs **identically on Windows / macOS / Linux** in a single container with normal Docker volume persistence.

<img width="944" height="448" alt="image" src="https://github.com/user-attachments/assets/e6e90ade-c439-462b-af81-8b2e6008e3dc" />

## How it works

- **List** — known instances (registry + on-disk `pb_data`), with live running/port/size.
- **Create** — registers the name, bootstraps schema + a default superuser via `pocketbase superuser upsert`, then starts the process.
- **Proxy** — a request to `<name>.<apex>` is reverse-proxied to that instance's private loopback port. Streaming is preserved, so the admin UI (`/_/`), REST API, file up/downloads and realtime (SSE) all work.
- **Lazy start** — an instance boots on its first request and is tracked in memory; optionally reaped after idle.
- **Delete** — stops just that one process and removes its folder. **Each instance is independent — no global restart, no downtime for the others.**

Only **known** subdomains ever spawn a process, so visiting a random subdomain can't create databases.

## Routing & access

Routing is by `Host` subdomain against a configurable `APEX_DOMAIN`:

| Host | Goes to |
|------|---------|
| `<apex>` or `panel.<apex>` or any other host/IP | management panel (Basic Auth) |
| `<name>.<apex>` | PocketBase instance `<name>` |
| `<name>.<apex>/_/` | that instance's admin UI |

`APEX_DOMAIN` defaults to **`localhost`** — browsers resolve `*.localhost` to 127.0.0.1, so `http://myapp.localhost:8090/_/` just works with **zero DNS setup**. In production set a real wildcard domain (e.g. `pocket.example.com` with `*.pocket` → server IP).

## Run

```bash
cp .env.example .env        # set PANEL_PASS + PB_ADMIN_PASSWORD
docker compose up -d --build
# panel:    http://localhost:8090
# instance: http://<name>.localhost:8090/_/   (after you create <name>)
```

Data lives in the named volume `pbdata` (`/data` → `registry.json` + `instances/<name>/pb_data`). It survives container removal, rebuilds and reboots; back up by copying that volume.

## Config (env)

| Env | Default | Description |
|-----|---------|-------------|
| `PORT` | `8090` | Public port (panel + proxy) |
| `APEX_DOMAIN` | `localhost` | Subdomain routing apex |
| `PANEL_USER` / `PANEL_PASS` | `admin` / — | Panel Basic Auth |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | `admin@example.com` / — | Default superuser per instance |
| `IDLE_TIMEOUT_MS` | `0` | Stop an instance after N ms idle (0 = never) |
| `INSTANCE_PORT_BASE` / `INSTANCE_PORT_MAX` | `9001` / `9999` | Internal loopback port range |

The PocketBase version is pinned in the `Dockerfile` (`PB_VERSION`). No npm dependencies — just the Bun runtime + the PocketBase binary.
