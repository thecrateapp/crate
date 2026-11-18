---
title: Development setup
summary: Run the complete local Crate stack and its four web workspaces.
section: start
audience: [developer]
status: canonical
order: 20
verified: 2026-07-21
sources:
  [
    Makefile,
    docker-compose.dev.yaml,
    docker-compose.readplane.dev.yaml,
    app/requirements-test.in,
    app/pip-audit-ignore.txt,
  ]
---

# Development setup

## Prerequisites

- Node.js 20+ and npm.
- Docker Engine and Docker Compose v2.
- Python/uv and Go/Rust only when working directly on those services.
- The repository checkout and its `test-music/` fixture library.

```bash
git clone https://github.com/thecrateapp/crate.git
cd crate
npm install
make dev
```

`make dev` is the supported local entry point. It combines
`docker-compose.dev.yaml` and `docker-compose.readplane.dev.yaml`, builds the
backend stack and starts the Vite applications. Do not start only the base dev
compose if the change involves readplane-routed endpoints or SSE.

## Local services

| Surface   | Local port | Normal development hostname         |
| --------- | ---------: | ----------------------------------- |
| Admin     |       5173 | `https://admin.dev.lespedants.org`  |
| Listen    |       5174 | `https://listen.dev.lespedants.org` |
| Docs      |       5175 | `https://docs.dev.cratemusic.app`   |
| Site      |       5176 | `https://www.dev.cratemusic.app`    |
| Cast UI   |       8591 | `https://cast.dev.lespedants.org`   |
| API       |       8585 | `https://api.dev.lespedants.org`    |
| Readplane |       8686 | `http://localhost:8686`             |

The local backend includes PostgreSQL, cache Redis, durable Redis, `slskd`, API,
readplane, workers for normal/maintenance/analysis/playback work, projector,
media worker and Caddy. The dev fixture has three artists and 122 tracks.

## Sentry observability

Sentry is split by runtime so failures remain attributable and queryable:

| Runtime                         | Sentry project        | Configuration                                                |
| ------------------------------- | --------------------- | ------------------------------------------------------------ |
| FastAPI                         | `crate-api`           | `SENTRY_API_DSN` in `.env`                                   |
| Python workers and projector    | `crate-workers`       | `SENTRY_WORKERS_DSN` plus a per-process `SENTRY_SERVICE` tag |
| Go readplane                    | `crate-readplane`     | `SENTRY_READPLANE_DSN` in `.env`                             |
| Rust media worker               | `crate-media-worker`  | `SENTRY_MEDIA_WORKER_DSN` in `.env`                          |
| Admin                           | `crate-admin`         | `SENTRY_ADMIN_DSN` GitHub Actions Variable                   |
| Listen web, Capacitor and Tauri | `crate-listen`        | `SENTRY_LISTEN_DSN` GitHub Actions Variable                  |
| Cast receiver                   | `crate-cast-receiver` | `SENTRY_CAST_RECEIVER_DSN` GitHub Actions Variable           |
| Documentation site              | `crate-docs`          | `SENTRY_DOCS_DSN` GitHub Actions Variable                    |

Runtime DSNs are injected by Compose. Browser DSNs are public identifiers and
are embedded by the production image/mobile workflows. The
`SENTRY_AUTH_TOKEN` Actions Secret is used only during trusted push builds to
upload source maps, Android R8 mappings and Tauri native debug symbols; it is
never stored in a runtime image. The desktop workflow uploads only the shipped
binary and its PDB or dSYM (`app/listen-desktop/scripts/debug-symbol-files.mjs`),
and a Sentry failure there leaves a warning instead of keeping the packages out
of the release. Android symbol upload runs only for signed tag
releases. The current iOS workflow builds an unsigned simulator app, so there
is no distributed iOS archive or production dSYM to upload yet.

All deployable builds use the Git SHA in `SENTRY_RELEASE`. The SDKs keep
default PII collection disabled and redact credentials, cookies, query strings
and user contact fields before sending events. Handled API 5xx responses,
terminal task failures, projector failures and media-worker job failures are
captured explicitly because they do not necessarily raise an uncaught process
exception.

Local frontend builds run without Sentry unless `VITE_SENTRY_DSN` is exported.
This keeps development noise and accidental local event uploads opt-in.

For local TLS and hostnames:

```bash
make dns-setup       # *.crate.local -> 127.0.0.1; requires sudo
make trust-local-ca  # trusts the mkcert CA used by the local Caddy certificate
```

Those targets are convenience helpers, not portable prerequisites. Run
`make trust-local-ca` once on macOS. `make dev` generates the local certificate
from the already trusted `mkcert` CA when it is missing, so recreating the
Caddy data volume does not change the certificate authority used by browsers.
`make dev` also advertises project development domains through Caddy; verify
the active Caddyfile and local resolver when cookies or TLS are relevant to
your change.

The seeded development account is `admin@cratemusic.app` / `admin`.

The Cast receiver can be previewed without a physical device or CAF runtime:

```bash
npm run --workspace=app/cast-receiver dev -- --host --port 5179
# Open http://localhost:5179/?preview=1
```

Physical Cast devices require a publicly reachable HTTPS receiver URL and a
registered development application ID; they do not trust the local mkcert CA.
See [Cast receiver operations](../operators/cast-receiver.md) and complete the
[Cast release checklist](../testing/cast-release-checklist.md) before enabling
the custom receiver.

## Focused workflows

```bash
make dev-back     # backend, including readplane overlay
make dev-admin    # Admin Vite on 5173
make dev-listen   # Listen Vite on 5174
make dev-docs     # Docs Vite on 5175
make dev-site     # marketing Site Vite on 5176
make dev-logs s=worker
make dev-down
```

The npm workspace includes `app/shared/ui`, the shared Cast protocol,
`app/cast-receiver`, `app/ui`, `app/listen` and `app/listen-desktop`. Docs and
Site are standalone Vite apps; their dependencies are installed by `make dev`.

## Federation harness

Federation uses a separate two-node stack so it never shares the normal dev
database or fixture media:

```bash
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-down
```

Node A exposes API/readplane/Admin/Listen on 18585/18686/15173/15174; Node B
uses 28585/28686. There are focused acceptance targets for global catalog,
playback prepare, imports, singleton parity and zero-downtime catalog reads.
Read [Federation overview](federation-overview.md) before changing those flows.

## Python dependencies

The backend images and CI install Python packages only from hashed lock files.
Each requirements set has a human-edited input and a compiled lock in `app/`:

| Input (edit this)             | Lock (generated)               | Installed by                                                 |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `requirements-api.in`         | `requirements-api.txt`         | `api` and `worker-playback` images                           |
| `requirements-worker-core.in` | `requirements-worker-core.txt` | `worker-core` image                                          |
| `requirements-worker.in`      | `requirements-worker.txt`      | analysis image (core plus `requirements-worker-analysis.in`) |
| `requirements-beat-this.in`   | `requirements-beat-this.txt`   | analysis image with torch (`PANNS=on/auto`)                  |
| `requirements.in`             | `requirements.txt`             | CI type check and lint                                       |
| `requirements-test.in`        | `requirements-test.txt`        | CI tests and the local virtualenv                            |

`make python-lock` compiles every lock with a pinned `uv pip compile --universal
--generate-hashes` for Python 3.13, so one lock serves Linux amd64/arm64 images and
macOS development. `requirements-test.txt` is the superset and is compiled first;
the other locks are compiled against it (and `requirements-beat-this.txt` against
`requirements-worker.txt`), so a package has the same version in every lock and the
analysis image can install its layers on top of each other. Existing pins are kept
unless an input changes or an upgrade is requested.

- Add, remove or constrain a dependency: edit the `.in` file, run
  `make python-lock` and commit the `.in` and every changed `.txt` together.
- Upgrade one package: `make python-lock LOCK_ARGS="--upgrade-package fastapi"`.
- Upgrade everything: `make python-lock LOCK_ARGS="--upgrade"`, then build the
  images (`docker build --target worker-analysis --build-arg PANNS=on app`) and
  run the backend tests before merging.
- Install locally: `uv pip install --require-hashes -r app/requirements-test.txt`
  into the repository `.venv` (or `pip install --require-hashes ...`).
- Never edit a `.txt` lock by hand; CI regenerates the locks and fails if they
  differ from the committed files.

torch and torchaudio come from the PyTorch CPU index, pinned by wheel URL per
architecture in `requirements-beat-this.in`; bump them together and check Beat
This! on the new pair (see the Dockerfile). `essentia-tensorflow` is pinned to
`2.1b6.dev1389`, the last build with Python 3.13 wheels; later dev builds ship only
Python 3.14 wheels and would not install in the images.

`make python-audit` runs `pip-audit` against every lock and fails on any known
vulnerability. The backend workflow runs it, with the lock check, in the
`dependency locks and audit` job. Fix a finding by upgrading the package. When an
advisory cannot be fixed yet or does not apply, add its ID to
`app/pip-audit-ignore.txt` with a comment naming the package, the reason, who
accepted it and when to review it; remove the line once a fixed release is locked.
`pip-audit` skips URL requirements, so the target audits the torch and torchaudio
versions from `requirements-beat-this.in` in a second pass.

## Tests and migrations

`make dev-test` runs backend checks plus Python, Go, Rust and frontend checks;
it is not a worker-only pytest shortcut. For a narrow Python test use the
project virtual environment or `uv run pytest`; for a full isolated backend run
use `make dev-test-backend`.

Alembic is the authoritative schema path. API/worker startup serializes
`alembic upgrade head` with an advisory lock. Add migrations under
`app/crate/db/migrations/versions/`; do not bootstrap schema changes from a
frontend or an ad-hoc script.

See [Developer guide](developer-guide.md) for ownership boundaries and the
complete repository map.
