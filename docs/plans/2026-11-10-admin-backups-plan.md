# Backups managed from Admin · Design and implementation plan

Date: 2026-11-10. Requested by Diego: "esto se debe poder gestionar desde admin, hay que hacer un panel en settings o donde sea, para gestionar todo el tema de backups, con proveedores, políticas de retención, etc."

Branch: `feat/admin-backups`, worktree `~/Code/Ninja/crate-agents/admin-backups`.

## 1. Where we start

- **Local dumps:** `crate-postgres-backup` (`prodrigestivill/postgres-backup-local`), configured in `docker-compose.yaml`. Its retention used to be hard-coded at 7 daily, 4 weekly and 6 monthly, with `-Z1`, on the system disk.
- **Interim work (phase BK0), in progress by another agent:**
  - configurable retention (3 daily, 4 weekly, 3 monthly) and `-Z6`;
  - dumps moved to a named Docker volume on `/var`;
  - an off-site `restic` sidecar to **Cloudflare R2** (S3-compatible) and **Google Drive** (rclone, scope `drive.file`). This instance uses those two; Backblaze B2 was discarded on 2026-11-10.
  - That gives off-site protection now. This plan replaces those sidecars with a subsystem Crate manages itself.
- **Building blocks that already exist:**
  - `app/crate/credentials.py`: Fernet-encrypted secret store (`CRATE_CREDENTIAL_KEY`), with `store_secret`, `load_secret`, `rewrap_secrets` and `revoke_secret`;
  - `app/crate/scheduler.py`: interval schedules (`DEFAULT_SCHEDULES`, `get_schedules`, `set_schedules` and `should_run` with jitter), run by the worker's service loop;
  - Admin `Settings` (`app/ui/src/pages/Settings.tsx`) with the sections general, downloads, schedules, enrichment, storage and audit;
  - `app/crate/api/native_oauth.py`, a pattern for the OAuth flows.

## 2. Goals

1. **Everything from Admin:** see backup health, manage destinations (providers), policies (what, when, how long, where), runs, verification and restore drills.
2. **Secrets never leave the server in clear text,** and never come back to the UI after they are saved.
3. **Self-hosted installs** get a safe default: daily local dumps, with off-site off until configured.
4. **Recovery is possible without the server:** a recovery kit the operator keeps elsewhere.

Out of scope for v1: in-place restore of the production database from the UI. It stays a documented CLI runbook; the UI offers restore drills and restore into a separate database only.

## 3. Design

### 3.1 Engine

- **Where it runs:** backups run as worker tasks on the maintenance queue. The worker image gains:
  - `pg_dump`/`pg_restore`, matching PostgreSQL 15;
  - `restic` and `rclone`, with versions pinned and checked with checksums at build time.
- **Kinds of job:**
  - `backup.dump`: `pg_dump -Fc` to the local backup volume, with a checksum and its size. It replaces the `prodrigestivill` sidecar.
  - `backup.local_retention`: grandfather-father-son pruning of the local dumps.
  - `backup.offsite`: `restic backup` of the chosen dump to each destination of the policy, tagged `daily`, `weekly` or `monthly`, then `forget --prune` with the policy retention.
  - `backup.verify`: `restic check` (a configurable read subset).
  - `backup.restore_drill`: restore the latest snapshot to a temp dir, `pg_restore --list`, then a restore into a throwaway database (`crate_restore_drill`), a few sanity queries, and a drop.
- **Locking:** one advisory lock per destination, so no two jobs write to the same repository.
- **Load:** jobs respect the governor (load and swap) and an optional window, like the analysis backfill.

### 3.2 Data model (migration, next free number at merge time)

| Table | Fields |
| --- | --- |
| `backup_destinations` | `id`, `kind` (`local`, `b2`, `s3`, `gdrive`, `dropbox`, `sftp`), `name`, `config_json` (non-secret: bucket, region, endpoint, path, host), `secret_ref` (credentials store), `repo_password_ref`, `enabled`, `status`, `last_checked_at`, `last_error` |
| `backup_policies` | `id`, `name`, `enabled`, `schedule` (interval or daily time, plus an optional window), `keep_daily`, `keep_weekly`, `keep_monthly`, `compression`, `verify_every_days`, `drill_every_days` |
| `backup_policy_destinations` | `policy_id`, `destination_id`, `tier` (which dumps go: daily, weekly, monthly) |
| `backup_runs` | `id`, `policy_id`, `destination_id`, `kind`, `status`, `started_at`, `finished_at`, `bytes`, `snapshot_id`, `checksum`, `error`, `task_id` |

Secrets never go into these tables: only `secret_ref` pointers into `credentials.py`.

### 3.3 Providers

| Kind | Mechanism | Credentials in Admin |
| --- | --- | --- |
| `local` | Backup volume | none |
| `b2` | restic `b2:` | key ID and application key, restricted to the bucket |
| `s3` | restic `s3:` (S3-compatible: R2, Wasabi, MinIO, Hetzner Object Storage) | endpoint, bucket, access and secret key |
| `gdrive` | restic `rclone:` + rclone `drive`, scope `drive.file` | **OAuth from Admin** ("Connect Google Drive"); the token is stored as a secret |
| `dropbox` | restic `rclone:` + rclone `dropbox` | OAuth from Admin |
| `sftp` | restic `sftp:` (Hetzner Storage Box, Home, rsync.net) | host, user, SSH key (generated by Crate; the public key is shown to install on the other side) |

**Test connection** for each destination: a write, read and delete probe, plus `restic snapshots` once initialised.

### 3.4 restic password and the recovery kit

- **The password:** each destination gets its repository password, generated by Crate and stored as a secret.
- **The problem:** if the server is lost, its database and its secrets are lost with it.
- **The recovery kit:**
  - **what it holds:** repository locations, passwords, restore steps, and the `CRATE_CREDENTIAL_KEY` fingerprint, but not the key itself;
  - **how it is given:** shown **once** when a destination is created, and downloadable again only after re-authentication. Every download is audited;
  - **"kit not saved" warning:** Admin shows it until the operator confirms the kit is stored off the server.

### 3.5 API (admin, permission `system.backups.manage`, everything audited)

- `GET /api/admin/backups/overview`:
  - health per destination: last success, age, size, next run;
  - the alerts.
- **Destinations:**
  - `GET/POST/PATCH/DELETE /api/admin/backups/destinations`;
  - `POST …/{id}/test`;
  - `POST …/{id}/oauth/start` and the `…/oauth/callback`.
  - Secret fields are **write-only** and never returned.
- **Policies:** `GET/POST/PATCH/DELETE /api/admin/backups/policies`.
- **Runs:**
  - `GET /api/admin/backups/runs?…`, paged;
  - `POST /api/admin/backups/run` (`policy` and `kind`), deduplicated as a task.
- `GET /api/admin/backups/destinations/{id}/snapshots`.
- `POST /api/admin/backups/recovery-kit` (re-auth required).
- **Never:** in-place restore, raw secret reads, or rebuilding anything inside a request.

### 3.6 Admin UI: a new "Backups" section in Settings

- **Overview:**
  - a status line per destination (healthy, late or failing) and the last successful off-site copy, highlighted if older than its schedule allows;
  - the total size;
  - "Run now", "Verify" and "Restore drill";
  - the "recovery kit not saved" warning.
- **Destinations:** a list, then add or edit through a provider picker, provider-specific forms, OAuth "Connect" buttons and "Test connection". It shows the repository size and snapshot count.
- **Policies:** schedule and window; retention as daily, weekly and monthly counts, with a live estimate of copies and storage; which destinations get which tier; compression; verification and drill cadence.
- **Runs:** history with filters, the error detail and a link to the task.
- **Conventions:** follow the Admin conventions (`app/ui/AGENTS.md`): `sonner`, `lucide-react`, Nivo for the size chart, `@crate/ui` components only where shared, no hand-written colours. **Mockups come first** (gate BG1).

### 3.7 Alerts and observability

- **Alerts** go through Admin's existing notification channel:
  - a failed run;
  - no successful off-site copy within 1.5 × its interval;
  - a failed verification or drill;
  - a destination failing its connection test.
- **Prometheus metrics:**
  - `crate_backup_last_success_timestamp{destination,kind}`;
  - `crate_backup_bytes`;
  - `crate_backup_run_duration_seconds`;
  - a Grafana panel in the observability stack.

## 4. Phases

### BK0 · Interim protection (in progress, separate agent)

Compose retention, `-Z6`, the Docker volume, and the R2 and Drive restic sidecar with the first snapshots and a restore drill. These keep running until BK6 migrates them.

### BK1 · Engine: dump and local retention

1. Worker image: `pg_dump` 15, `restic` and `rclone`, pinned, plus a test that checks their versions.
2. `backup.dump` and `backup.local_retention` tasks, with the `backup_runs` model and its migration.
   - **Red tests:**
     - the dump file's validity (`pg_restore --list`);
     - retention keeps exactly N daily, weekly and monthly dumps across a simulated calendar;
     - a failed dump leaves no partial file.
3. A default local policy for every install, with a scheduler entry.

### BK2 · Destinations and secrets

1. The `backup_destinations` model, secrets through `credentials.py`, and the generated repository password.
2. Providers `local`, `b2`, `s3` and `sftp` with test connection.
   - **Red tests:**
     - a restic round-trip against a local MinIO and an SFTP container in tests;
     - secrets are never in API responses or logs.
3. `gdrive` and `dropbox` through rclone, with the OAuth flow (`native_oauth.py` pattern).
   - **Red tests:** the token is stored encrypted; the OAuth state is checked; the scope is `drive.file`.

### BK3 · Policies, off-site, verification and drills

1. The `backup_policies` model and its tiers per destination; scheduling with windows and governor checks.
2. `backup.offsite` with `forget --prune` per policy, `backup.verify` and `backup.restore_drill`.
   - **Red tests:**
     - restic retention matches the policy;
     - the drill never touches the production database;
     - per-destination locking;
     - a run is resumed or cleaned up after a worker restart.

### BK4 · Admin API

- The endpoints in §3.5, behind permission `system.backups.manage`, with audit entries and write-only secrets.
- Tests: OpenAPI contract, permissions (403 without the permission), and the re-auth requirement for the recovery kit.

### BK5 · Admin UI

1. **Mockups** of overview, destinations, policies and runs, in the same style as the other Admin sections.
   - **Gate BG1 (Diego):** approve the mockups.
2. Implementation, with Vitest and Testing Library tests, and visual specs where Admin has them.

### BK6 · Alerts, metrics and the migration of production

1. Alerts and metrics (§3.7), plus the Grafana panel.
2. **Migration in production:**
   - recreate the R2 (`s3` kind) and Drive destinations from the BK0 sidecar configuration: same repositories, same restic password, imported as secrets;
   - run the engine in parallel with the sidecars for one weekly cycle and compare;
   - **gate BG2 (Diego):** retire the sidecars.
3. **Operator docs:** setup, providers, the recovery kit, and the CLI restore runbook.

## 5. Risks

- **Losing the server and the credentials key together.** The recovery kit and its "not saved" warning exist for exactly this.
- **OAuth tokens expire or are revoked** (Google, Dropbox). The connection test runs on a schedule and raises an alert.
- **Load:** a dump and an off-site upload compete with the analysis backfill. They run under the governor, and big uploads go inside a window.
- **Self-hosted installs without the new binaries,** for example custom images: the panel shows the destination as unavailable instead of failing silently.
