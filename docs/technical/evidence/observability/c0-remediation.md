# C0 remediation — 2026-10-31

Source changes are prepared and scoped checks passed. Runtime rollout and new
Sentry receipts are pending; this record does not declare C0 accepted.

## Infrastructure budget

Grafana changes from 256 to 384 MiB and Prometheus from 384 to 256 MiB, preserving
the 944 MiB / 1 CPU aggregate admission limit. The cAdvisor relabel allowlist adds
exactly nginx, traefik and slskd alongside crate-prefixed services. After retiring
Tidarr, the expected running-service coverage is 33/33; verify it after rollout.

The longer baseline showed Grafana reaching 252.4/256 MiB while Prometheus peaked
at 64.3/384 MiB. This motivates rebalancing the existing allocation; it is not a
claim that future resource needs are bounded by the short test.

## Tidarr retirement and preservation

Crate's native Tidal integration uses local tiddl and separate credentials.
265 tidal_download tasks completed in the observed seven-day window. Tidarr had
no download activity in the inspected logs; a recent interface request left
manual use ambiguous. Diego explicitly confirmed it is unused and authorized
retirement while preserving its data.

A private backup was completed and verified on the server before removal:
`/home/crate/crate/data/retired/tidarr/20261031T120357Z`.
It includes actual /shared authentication/queues, changed writable-layer state,
immutable image references, original Compose configuration and restoration notes.
The tar contains 44 files; SHA256 and a second source-content comparison passed.
Directory mode 0700 and file mode 0600 were checked. No restore drill is claimed.
No credentials, archive contents or container environment values are committed.

Source retirement removes the service/router/local override, port example,
initial directory, Stack outlink and action allowlist. Native Tidal/tiddl,
tidalrr imports and existing download/library directories remain separate.
Production stop/removal is still pending the reviewed rollout; removal must not
use volume-deletion flags or delete the preserved host directories.

## Radar 404 classified

A bounded reload captured 132 network observations without truncation and
reproduced one 404 from Cover Art Archive:
`https://coverartarchive.org/release-group/:release_group/front-500`.
It was an image GET served through the service worker, not an application API
response. The release-group identifier is omitted from this evidence.

The artwork lifecycle already treats failed/preload-unavailable art as not ready,
while ArtworkSurface keeps its fallback visible. Existing artwork surface/image
tests passed 17 cases. The failed URL was not present in the rendered img nodes at
inspection, so a specific card's visual fallback is not independently asserted.
No API success response or fake image was added to mask an upstream 404. This is
classified as unavailable external artwork rather than a blocker for PR1A's
internal-metric integrity work.

## Sentry fixes

### Python delivery

The effective before_send callback accepted only event; the SDK calls it with
event and hint. That raises TypeError and can discard error/message events.
It now accepts an optional hint while retaining the same recursive privacy
scrubbing. A real SDK client with an in-memory transport verifies event ID,
envelope delivery and redaction, without network access.

The initial diagnostic/test also used a standalone Scope that was not active in
the current SDK. The corrected probe uses isolation_scope and the global capture
API; callback causality was checked independently: legacy one-argument callback
delivers zero envelopes, current callback delivers one. No scrubber bypass was
used to claim successful delivery.

### Rust HTTPS

Media Worker and Desktop selected Sentry's ureq transport with default features
disabled, without a TLS backend. Both now select rustls. Feature graphs verify
ureq/rustls with ring and webpki roots; existing package versions were preserved.
Media Worker Rust 1.88 and Desktop Rust 1.94 each passed five observability tests.
The production HTTPS receipt still requires the rebuilt Media Worker image;
Desktop distribution/installed-client verification is separate.

### Release provenance

The host SENTRY_RELEASE pin was older than both the running deployment and image
source revisions. Managed release environment generation now derives six backend
release variables from each image's source_sha. Compose selects the matching
variable and retains the manual SENTRY_RELEASE fallback for unmanaged deployments.
The full deployment SHA and reused image source SHA remain distinct.

The validator accepts old release.env files, clears absent managed pins and
keeps the custom fallback. Metadata-only changes recreate the affected roles;
rollback restores previous Compose and environment files first. The operator
backup-selection predictor now matches those metadata-only transitions too;
a differential regression checks missing, stale and current worker pins against
the real deployment shell, including zero image pulls. Native image
builds, standard immutable deployment and receipt verification remain pending.

A pre-fix Go secondary-process diagnostic was received as event
`c09a39a1af3141bc913306a3125b9cce` at 12:02:48 UTC with the old release.
API/worker Python and Media Worker pre-fix probes did not establish delivery.
The prior web journey has no verified Sentry error/transaction receipt; HTTP 200
envelopes alone do not establish ingestion or symbolication.

## Verification and remaining gate

- Scoped configuration/retirement/Sentry suites passed 120 cases; release/deploy
  checks passed 129 cases with 25 platform-dependent skips on macOS. After the
  predictor correction, its focused suites passed 45 cases with 25 skips.
- Stack tests passed 15 cases; existing artwork tests passed 17 cases.
- Rust observability tests passed 5 Media Worker and 5 Desktop cases.
- Independent release/fallback/rollback review passed. Linux collector CI and
  closing validation have not yet run for this revision.
- Preserve the Tidarr backup, deploy immutable main artifacts, apply/verify the
  monitoring budget and coverage, retire only Tidarr, then capture new per-image
  Sentry diagnostic receipts. Do not claim runtime fixes from source tests alone.
