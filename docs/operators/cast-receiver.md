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
