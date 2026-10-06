# Crate

Self-hosted music platform with enrichment, analysis, streaming, acquisition, federation and a
snapshot-backed read plane. Production manages roughly 900 artists, 4,400 albums, 48K tracks and
1.2 TB of audio.

This file holds the platform-wide rules. Each part of the monorepo has a scoped `AGENTS.md` with
the rules you need when editing it; read the one closest to the files you touch.

| Area                                 | Scoped instructions                   |
| ------------------------------------ | ------------------------------------- |
| FastAPI routers, schemas, middleware | `app/crate/api/AGENTS.md`             |
| Database layer, migrations           | `app/crate/db/AGENTS.md`              |
| Workers, actors, projector, daemons  | `app/crate/worker_handlers/AGENTS.md` |
| Listen app (web, PWA, Capacitor)     | `app/listen/AGENTS.md`                |
| Admin app                            | `app/ui/AGENTS.md`                    |
| `@crate/ui` and shared frontend code | `app/shared/AGENTS.md`                |
| Desktop app (Tauri)                  | `app/listen-desktop/AGENTS.md`        |
| Go read plane                        | `app/readplane/AGENTS.md`             |
| Rust media worker                    | `app/media-worker/AGENTS.md`          |
| Cast receiver                        | `app/cast-receiver/AGENTS.md`         |
| Documentation site                   | `app/docs/AGENTS.md`                  |

## Architecture

```
crate-api                (FastAPI, Python 3.13)  → :8585, /music read-only
crate-readplane          (Go)                    → low-latency snapshot/read routes + SSE relay, FastAPI fallback
crate-worker             (Python + Dramatiq)     → default + fast queues, service loop (scheduler, watcher, recovery), /music rw
crate-fast-worker        (Python + Dramatiq)     → extra fast-queue capacity, /music rw
crate-maintenance-worker (Python + Dramatiq)     → repair, sync, enrichment, maintenance queue, /music rw
crate-analysis-worker    (Python + native DSP)   → heavy queue, analysis and bliss daemons, /music read-only
crate-playback-worker    (Python + ffmpeg)       → playback prepare/transcode queue, /music read-only
crate-projector          (Python)                → outbox relay + Redis Streams domain events → warmed ui_snapshots
crate-media-worker       (Rust)                  → album/track ZIP packages with Redis progress/cancel
crate-ui                 (React 19 + Vite)       → admin web app
crate-listen             (React 19 + Vite)       → listening app (web PWA + Capacitor iOS/Android)
crate-listen-desktop     (Tauri 2)               → desktop shell around app/listen
crate-cast-receiver      (Vite, CAF v3)          → Google Cast receiver
crate-site / crate-docs  (React 19 + Vite)       → cratemusic.app and technical docs
crate-postgres           (PostgreSQL 15)         → data
crate-redis / redis-durable (Redis 7)            → cache, broker, invalidation replay, metrics, domain-event streams
```

`tools/crate-cli/` is the Rust CLI used for bliss similarity vectors and audio tooling.

## Platform rules

- The API mounts `/music` read-only. Every write to the library (tags, moves, deletes, artwork)
  runs in a worker task. Never write to the library from an API handler.
- All SQLAlchemy and transaction-scope usage lives in `app/crate/db/`. Code outside it calls
  functions from concrete modules (`crate.db.queries.*`, `crate.db.repositories.*`,
  `crate.db.jobs.*`). `from crate.db import ...` is forbidden outside the package and
  `crate/db/__init__.py` is a frozen facade; tests fail on either.
- Use `read_scope()` for reads and `transaction_scope()` for writes, and pass `session=` down so a
  request uses one transaction.
- Performance on hot paths:
  - Never `COUNT`/`SUM`/`AVG` over `library_tracks` during an HTTP request; precompute.
  - Batch lookups with `ANY(:ids)`; no N+1 loops.
  - Consolidate related reads into one CTE query instead of several `read_scope()` calls.
  - Never rebuild snapshots in a request; serve the cached surface and let the projector or a
    deduplicated task refresh it.
  - SSE/WebSocket effect dependencies must not include per-frame values (`currentTime`,
    `isPlaying`); use refs.
- No emojis in UI text.
- A component goes into `@crate/ui` only when both admin and Listen use it.
- Keep `app/ui` and `app/listen` as separate apps. Their conventions differ: admin uses `sonner`
  and `lucide-react`; Listen uses `notify` from `@crate/ui/lib/notify` and `@crate/ui/icons`.
- Charts use Nivo. recharts is not a dependency.

## Testing policy

"If you touch it, you test it."

- Every refactor, feature or bugfix includes tests covering the changed behaviour.
- Python: at least one `pytest` case per public function changed. Go: table-driven tests.
  TypeScript/React: Vitest + Testing Library.
- Run the relevant suite and confirm it is green before calling a task done.
- If something is genuinely untestable, leave a `TEST_GAP:` comment explaining why.

Backend tests run from `app/` with the repo virtualenv; PostgreSQL-backed tests use the
`pg_db` fixture, which falls back to Testcontainers when no test database is configured:

```bash
cd app && ../.venv/bin/python -m pytest tests/<file>.py -q
docker compose -f docker-compose.dev.yaml exec worker pytest tests/<file>.py -q   # inside the dev stack
make dev-test            # backend, readplane, Rust and frontend checks
```

## Dev environment

```bash
npm install                                  # workspaces: shared/ui, shared/cast, ui, listen, listen-desktop, cast-receiver
make dev                                     # Docker backend + frontend dev servers
npm run --workspace=app/ui dev               # admin, :5173
npm run --workspace=app/listen dev           # Listen, :5174 (API_URL overrides the proxied API)
npm run --workspace=app/shared/ui build      # @crate/ui dist
```

- `app/site` and `app/docs` are not npm workspaces: use `npm ci --prefix app/<name>`.
- Pre-commit hooks (`pre-commit install`) run Ruff, Prettier and ESLint.
- Local test library: `test-music/` (not committed). Dev seed login `admin@cratemusic.app` /
  `admin` works only against the local stack; it is not valid in production.

## Release and deploy

1. Merge to `main`. "Build & Push Docker Images" publishes immutable images and a release
   manifest for the merge SHA.
2. Tag releases on the merge commit with an annotated tag (`vX.Y.Z`). Tag workflows build the
   Desktop, Android and iOS artifacts and create the GitHub release. macOS desktop builds are
   ad-hoc signed; there are no Apple signing secrets.
3. Deploy that SHA:

   ```bash
   make deploy-preflight VERSION=<full-main-sha>
   make deploy VERSION=<full-main-sha>      # image-first, health checks, automatic rollback
   ```

Never `rsync --delete` the project root: the server keeps `media/` and `data/` that do not
exist locally.

## Server

- SSH: `crate@95.216.3.27`, path `/home/crate/crate`
- Domains: `listen.lespedants.org` (Listen), `admin.lespedants.org` (admin),
  `api.lespedants.org` (API; `/rest` is the Open Subsonic layer), `cratemusic.app` (site)

## Skills and references

- Long-form technical docs: `docs/technical/` (rendered by `app/docs`).
- Backend patterns: `.claude/skills/python-backend.md`.
- Frontend: `.agents/skills/react-best-practices/AGENTS.md`,
  `.agents/skills/composition-patterns/AGENTS.md`,
  `.agents/skills/react-view-transitions/AGENTS.md`,
  `.agents/skills/web-design-guidelines/`.
