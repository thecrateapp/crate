---
title: Cast receiver operations
summary: Configure and operate Crate's hosted Google Cast receiver safely.
section: operations
audience: [operator]
status: canonical
order: 140
verified: 2026-09-17
sources:
  [
    app/cast-receiver,
    docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md,
  ]
---

# Cast receiver operations

Crate ships its Custom Web Receiver as the independent
`crate-cast-receiver` image. The production entry point is the HTTPS origin in
`CRATE_CAST_RECEIVER_HOST`; the image exposes `/healthz` and serves only the
receiver root plus immutable hashed assets. Unknown paths return `404` rather
than the receiver HTML.

## Required configuration

Keep the custom receiver disabled until Google has registered the receiver URL
and both sender applications use the resulting application ID.

Production `.env`:

```dotenv
CRATE_CAST_CUSTOM_RECEIVER_ENABLED=false
CRATE_CAST_RECEIVER_APP_ID=CC1AD845
CRATE_CAST_RECEIVER_HOST=cast.lespedants.org
SENTRY_CAST_RECEIVER_DSN=
SENTRY_CAST_RECEIVER_TRACES_SAMPLE_RATE=0.05
```

`CAST_RECEIVER_APP_ID` is public configuration, not a secret. The Android and
iOS workflows inject these same variables into the web bundle and native SDKs.
Tagged builds may keep using Google's default receiver while the custom
receiver is disabled. If enabled, the release gate requires matching
registered IDs that are valid 8-character values and not `CC1AD845`.

GitHub Actions repository variables used by static sender builds:

```text
CAST_CUSTOM_RECEIVER_ENABLED=false
CAST_RECEIVER_APP_ID=CC1AD845
SENTRY_CAST_RECEIVER_DSN=<receiver project DSN>
SENTRY_CAST_RECEIVER_TRACES_SAMPLE_RATE=0.05
```

The API, Listen web image, Android resource and iOS build setting must receive
the same registered 8-character app ID. Release preflight rejects an enabled
custom receiver when the ID is missing, malformed, or still Google's Default
Media Receiver (`CC1AD845`). Android and iOS Release builds enforce the same
contract.

## Google Cast registration

Create two Custom Web Receiver applications in the Google Cast SDK Developer
Console:

- `Crate Cast Dev`, unpublished and restricted to registered test devices;
- `Crate Cast`, published and pointing to the stable production URL.

Use `https://<CRATE_CAST_RECEIVER_HOST>/` as the receiver URL. The host must be
publicly reachable with a browser-trusted TLS certificate; local CA
certificates are insufficient for physical Cast devices. Keep development and
production application IDs separate.

## Pre-enable checks

Deploy the receiver image while the custom sender flag remains disabled, then
verify:

```bash
curl --fail --silent https://cast.lespedants.org/healthz
curl --fail --silent https://cast.lespedants.org/ >/dev/null
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  https://cast.lespedants.org/missing-resource)" = "404"
```

Confirm the root loads the expected immutable release in a normal browser and
that the receiver Sentry project receives `receiver.startup` without a session
lease, signed URL, title, artist, album, track ID, or queue content.

## Rollout

1. Publish the receiver image and validate `/healthz` with the custom sender
   flag off.
2. Enable the development application ID and complete the hardware checklist.
3. Set the production app ID in `.env` and the GitHub repository variables.
4. Build a new Listen/Android/iOS release from that configuration.
5. Set `CRATE_CAST_CUSTOM_RECEIVER_ENABLED=true`, run deploy preflight, and
   deploy the matching immutable release manifest.
6. Monitor launch, load, retry, skip, terminal error, queue conflict and
   spectrum-availability metrics.

The receiver image is part of the immutable release manifest and deployment
rollback. `Disconnect` leaves the receiver and lease active; `Stop Cast` stops
CAF playback and revokes the scoped lease.

## Spectrum pipeline

The receiver requests one lease-scoped spectrum resource per queue item. A
cache miss creates the deduplicated `generate_cast_spectrum` task on the heavy
analysis queue. The analysis worker uses ffmpeg to stream mono PCM, encodes 24
frequency bands every 100 ms and atomically stores a gzip-compressed CRSP v1
artefact under `${DATA_DIR}/cast-spectrum/`. PostgreSQL stores only its state,
source fingerprint, relative path and integrity metadata.

The endpoint returns `202` while queued and `425` while generating, both with
`Retry-After`. A ready artefact returns an immutable `ETag`; the receiver
revalidates it with `If-None-Match`. Missing, failed or stale artefacts never
block audio and render the bounded ambient fallback instead.

Useful diagnostics:

```bash
docker compose logs --since=15m crate-analysis-worker | grep generate_cast_spectrum
docker compose exec crate-postgres psql -U "${POSTGRES_SUPERUSER_USER:-crate}" \
  -d "${CRATE_POSTGRES_DB:-crate}" \
  -c "select status, count(*) from cast_spectrum_artifacts group by status;"
find "${DATA_DIR:-./data}/cast-spectrum" -type f -name '*.crsp.gz' | head
```

Do not delete a ready database row independently from its file. If a file is
missing, the next scoped request marks it pending and regenerates it. Source
fingerprints also invalidate artefacts automatically when the track changes.

## Rollback

Set `CAST_CUSTOM_RECEIVER_ENABLED=false` for the next sender build and
`CRATE_CAST_CUSTOM_RECEIVER_ENABLED=false` in production, then deploy that
release. Existing ticket endpoints and Google's Default Media Receiver remain
available; no database rollback is required. The previous receiver image stays
addressable by digest for sessions that are still running during the rollback
window.

## Local verification

`make dev` builds `crate-dev-cast-receiver` and exposes its health endpoint on
`http://localhost:8591/healthz`. The local TLS route is
`https://cast.dev.lespedants.org`, but it uses the development CA and therefore
is intended for browser/Compose checks, not Google device registration.

For a visual preview without CAF, run the Vite receiver and open `/?preview=1`:

```bash
npm run --workspace=app/cast-receiver dev -- --host --port 5179
```

## Telemetry policy

Receiver Sentry loads only when a DSN is present and uses its own release name
(`cast-receiver-<sha>`). Before-send and breadcrumb filters remove query
strings, scoped leases, signed URLs, queue data and listening metadata. Metrics
accept only bounded operational attributes such as outcome, attempt, source,
device category and CAF version.

## Troubleshooting

| Symptom                           | Check                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Receiver does not launch          | App ID, published/dev device registration, HTTPS URL and receiver `/healthz`        |
| Audio returns `Failed to fetch`   | `CRATE_CAST_PUBLIC_BASE_URL`, receiver CORS, public API TLS and Range preflight     |
| Default Google screen appears     | Sender flag is false, app ID is `CC1AD845`, or native/web IDs do not match          |
| Queue restarts after reconnect    | Receiver status messages, session lease expiry and queue revision conflicts         |
| Spectrum stays ambient            | Analysis-worker health, task status, writable `${DATA_DIR}` and ffmpeg availability |
| Playback works but controls drift | CAF media status/custom namespace events and receiver heartbeat writes              |
