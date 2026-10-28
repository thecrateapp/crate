---
title: Home quickstart
summary: Install a single Crate instance with the supported home Docker Compose profile.
section: start
audience: [operator]
status: canonical
order: 10
verified: 2026-10-26
sources:
  [
    install.sh,
    app/installer/internal/wizard/wizard.go,
    deploy/install/integrations.yaml,
    docker-compose.home.yaml,
  ]
---

# Home quickstart

Use this path for a single self-hosted Crate instance. It is intentionally
different from local development and the project-hosted deployment flow; see
[Deployment profiles](deployment-profiles.md) before mixing commands between
them.

## Prerequisites

- Linux or macOS on amd64 or arm64 (Apple Silicon, Raspberry Pi 4/5 and ARM servers run
  native images).
- Docker Engine and Docker Compose v2.
- A host with persistent storage for music, PostgreSQL and downloads.
- A music directory writable by the user that runs Docker.
- For public HTTPS, a domain managed by Cloudflare and a DNS API token. For a
  local-only instance, use the `ports`, `hosts` or `dnsmasq` access modes.

`install.sh` downloads the `crate` installer for your system from GitHub
Releases, checks its SHA-256 checksum, keeps it in `~/.local/bin` and runs
`crate install`, a step-by-step wizard. The installer embeds the
`docker-compose.yaml`, `config.yaml` and Traefik files of its release, writes
them with a mode-specific `.env` (owner-only) and starts Crate. Keep that
directory private: `.env` contains the database, JWT, Redis, readplane,
credential and federation secrets.

## Install

For an interactive installation:

```bash
curl -fsSL https://cratemusic.app/install.sh | bash
```

The wizard checks Docker, memory, disk and ports, asks for the music folder
and the access mode, offers the integrations (Last.fm, Fanart.tv, Spotify,
Discogs, Setlist.fm, Ticketmaster, Soulseek, Tidal, Telegram, AI models, agents
and social sign-in) with a link and steps to get each key, checks every key
against its provider, asks for the admin password, shows a review and waits
until the API answers. Pass `--dry-run` to see the plan without writing anything, or
`--accessible` for plain prompts that work with screen readers.

To install with Claude Code, Codex or another AI agent instead, see
[Install with an AI agent](00a-install-with-ai.md).

For a non-interactive public installation (the `CRATE_*` variables are the
same ones the previous script accepted):

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

The installer generates `JWT_SECRET`, the PostgreSQL password,
`REDIS_PASSWORD`, `CRATE_READPLANE_SERVICE_TOKEN`, `CRATE_CREDENTIAL_KEY` and
the two federation secrets when they are missing, and never regenerates an
existing one. Do not rotate or delete them casually: the readplane token
authenticates API/readplane traffic, Redis also carries the task broker and
durable streams, and `CRATE_CREDENTIAL_KEY` encrypts stored AI credentials.
`deploy/install/integrations.yaml` declares every variable the installer
writes.

## Integrations and health

```bash
crate configure            # choose integrations to set up, change or turn off
crate configure telegram   # go straight to one of them
crate doctor               # machine, Docker, services, API and every configured key
crate doctor --json        # the same report for scripts and agents
```

`crate configure` saves the keys in `.env` and restarts only the services that
use them. Soulseek can run inside Crate (the `soulseek` compose profile starts
slskd and imports what it downloads) or point at an slskd server you already
run. Tidal connects after Crate starts, from Admin > Settings > Downloads, with
a code you enter at tidal.com/activate. For unattended installs, export the
integration variables (for example `FANART_API_KEY`) before `crate install
--yes`; `deploy/install/integrations.yaml` lists them.

## Access modes and endpoints

| Mode         | Intended use                               | Main endpoints                                                                       |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `cloudflare` | Public HTTPS with Cloudflare DNS challenge | `https://admin.<domain>`, `https://listen.<domain>`, `https://api.<domain>`          |
| `hosts`      | A local domain listed in `/etc/hosts`      | `http://admin.<domain>`                                                              |
| `dnsmasq`    | Local wildcard DNS                         | `http://admin.<domain>`                                                              |
| `ports`      | A single machine or LAN port-forwarding    | `http://localhost:8580`, `http://localhost:8581`, `http://localhost:8585/api/status` |

Invite links use `CRATE_LISTEN_PUBLIC_BASE_URL` as their canonical Listen
origin. The home Compose profile derives it as `https://listen.<domain>` for
domain-based installs; override it with the actual reachable Listen URL for a
local or port-based installation.

The admin account is `admin@cratemusic.app`, with the password chosen in the
wizard or generated and shown at the end. Admin starts the library scan. Use
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

Run the installer again on the same directory. It prefills the answers from
the existing `.env`, rewrites the compose and config files of its release,
keeps every secret and any line you added by hand, and adds settings that are
new in this release:

```bash
crate install --dir /opt/crate
```

A release installer writes its own version as `CRATE_IMAGE_TAG`, so installer
`v3.1.0` runs the `v3.1.0` images. Every release tag adds that version tag to
the images of the tagged commit. On an existing installation the installer
moves `CRATE_IMAGE_TAG` forward only when it is `latest` or an older release
(`vX.Y.Z`); a newer release is never downgraded, and any other value, such as
a commit SHA, is kept. Development and pre-release builds of the installer
keep `latest`. `CRATE_IMAGE_TAG=<tag> crate install` sets the tag explicitly.
`crate configure` never changes it.

To use a specific release of the installer, set `CRATE_INSTALLER_VERSION` to
its tag when running `install.sh`.

Upgrading a 2.7 installation to 3.0 has extra steps; follow
[Upgrade from 2.7 to 3.0](upgrade-v2-to-v3.md).

Before an update, copy the existing `.env` and take a PostgreSQL backup. After
the update, repeat the verification commands above. If a database migration has
run, do not assume an image rollback is safe; use a forward fix or restore a
tested backup.

## Next steps

- Set up or change integrations with `crate configure`, and check the
  installation with `crate doctor`.
- Read [Operations](operations.md) for Redis, workers and restore handling.
- Read [Federation overview](federation-overview.md) before exposing or pairing
  an instance with another node. Federation is not a filesystem replication
  mechanism.
