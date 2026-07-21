---
title: Home quickstart
summary: Install a single Crate instance with the supported home Docker Compose profile.
section: start
audience: [operator]
status: canonical
order: 10
verified: 2026-07-21
sources: [install.sh, docker-compose.home.yaml]
---

# Home quickstart

Use this path for a single self-hosted Crate instance. It is intentionally
different from local development and the project-hosted deployment flow; see
[Deployment profiles](deployment-profiles.md) before mixing commands between
them.

## Prerequisites

- Docker Engine and Docker Compose v2.
- A host with persistent storage for music, PostgreSQL and downloads.
- A music directory writable by the user that runs Docker.
- For public HTTPS, a domain managed by Cloudflare and a DNS API token. For a
  local-only instance, use the `ports`, `hosts` or `dnsmasq` access modes.

The installer writes a mode-specific `docker-compose.yaml`, `config.yaml`,
Traefik federation proxy configuration and a mode-specific `.env`. Keep that
directory private: `.env` contains database, JWT, Redis and readplane secrets.

## Install

For an interactive installation:

```bash
curl -fsSL https://cratemusic.app/install.sh | bash
```

For a non-interactive public installation:

```bash
curl -fsSL https://cratemusic.app/install.sh \
  | CRATE_ASSUME_YES=1 \
    CRATE_ACCESS_MODE=cloudflare \
    CRATE_INSTALL_DIR=/opt/crate \
    CRATE_MUSIC_DIR=/srv/music \
    CRATE_DOMAIN=music.example.com \
    CF_DNS_API_TOKEN=replace-me \
    DEFAULT_ADMIN_PASSWORD=replace-me \
    bash
```

For direct local ports instead of a domain:

```bash
curl -fsSL https://cratemusic.app/install.sh \
  | CRATE_ASSUME_YES=1 CRATE_ACCESS_MODE=ports bash
```

The installer generates `JWT_SECRET`, `REDIS_PASSWORD` and
`CRATE_READPLANE_SERVICE_TOKEN` when they are not supplied. Do not rotate or
delete them casually: the token authenticates API/readplane traffic and Redis
also carries the task broker and durable streams.

## Access modes and endpoints

| Mode         | Intended use                               | Main endpoints                                                                       |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `cloudflare` | Public HTTPS with Cloudflare DNS challenge | `https://admin.<domain>`, `https://listen.<domain>`, `https://api.<domain>`          |
| `hosts`      | A local domain listed in `/etc/hosts`      | `http://admin.<domain>`                                                              |
| `dnsmasq`    | Local wildcard DNS                         | `http://admin.<domain>`                                                              |
| `ports`      | A single machine or LAN port-forwarding    | `http://localhost:8580`, `http://localhost:8581`, `http://localhost:8585/api/status` |

The Admin app creates the first administrator and starts a library scan. Use
Listen for playback and user-facing library features. Files received by uploads
or owned-purchase import are staged and published by workers; the API never
writes the music filesystem directly.

## Verify the installation

From the installation directory:

```bash
docker compose config -q
docker compose ps
docker compose logs --tail=100 crate-api crate-readplane crate-projector
```

The API health endpoint is `/api/status`. Confirm that API, readplane and the
projector are healthy before treating the instance as ready. A first library
scan and enrichment can take time; they run as background work.

## Update a home installation

The installer downloads a Compose-based installation; it is not a repository
checkout. Therefore `git pull && docker compose up -d --build` is not a valid
update command for this profile.

Re-run the installer with the same install directory and desired image/ref. It
refreshes the compose/config files and keeps an existing `.env` unless
`CRATE_FORCE_ENV=1` is explicitly set:

```bash
curl -fsSL https://cratemusic.app/install.sh \
  | CRATE_INSTALL_DIR=/opt/crate CRATE_REF=main bash
```

Before an update, copy the existing `.env` and take a PostgreSQL backup. After
the update, repeat the verification commands above. If a database migration has
run, do not assume an image rollback is safe; use a forward fix or restore a
tested backup.

## Next steps

- Configure optional enrichment credentials in `.env`, then recreate the
  affected services with `docker compose up -d`.
- Read [Operations](operations.md) for Redis, workers and restore handling.
- Read [Federation overview](federation-overview.md) before exposing or pairing
  an instance with another node. Federation is not a filesystem replication
  mechanism.
