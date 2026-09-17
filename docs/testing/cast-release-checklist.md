---
title: Cast release checklist
summary: Physical-device and protocol acceptance checks for a Crate Cast release candidate.
section: operations
audience: [developer, operator]
status: canonical
order: 150
verified: 2026-09-17
sources:
  [
    app/cast-receiver,
    app/listen,
    docs/plans/2026-09-14-crate-cast-receiver-implementation-plan.md,
  ]
---

# Cast release checklist

Complete this checklist against the exact release candidate commit. Record the
device/OS versions and attach screenshots, logs and Sentry links to the release
or PR. Mocked CAF tests are necessary but do not replace physical-device proof.

## Release identity

- Commit/tag:
- Receiver image digest:
- Receiver release URL:
- Development Cast app ID:
- Production Cast app ID:
- API/Listen release:
- Tester and date:

The app IDs may be recorded because they are public configuration. Never paste
a playback lease, bearer token or signed resource URL into this document.

## Automated gate

```bash
cd app && ../.venv/bin/python -m pytest \
  tests/test_cast_tickets.py \
  tests/test_cast_sessions.py \
  tests/test_cast_session_api.py \
  tests/test_cast_spectrum.py \
  tests/test_cast_spectrum_api.py -q
cd ..
npm run --workspace=app/shared/cast test
npm run --workspace=app/shared/cast typecheck
npm run --workspace=app/cast-receiver test
npm run --workspace=app/cast-receiver typecheck
npm run --workspace=app/cast-receiver lint
npm run --workspace=app/cast-receiver build
npm run --workspace=app/cast-receiver check:bundle
npm run --workspace=app/listen test
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen lint
npm run --workspace=app/listen build
.venv/bin/pre-commit run --all-files
docker compose config --quiet
docker compose -f docker-compose.dev.yaml config --quiet
```

- [ ] All commands pass on the candidate commit.
- [ ] React Doctor reports zero new errors and zero new warnings for Listen,
      the receiver and `@crate/ui` against `origin/main`.
- [ ] Receiver compressed JavaScript remains below 150 KB.
- [ ] Android debug lint/tests and iOS simulator build pass in CI.
- [ ] No PR review finding remains unresolved.

## Receiver hosting and registration

- [ ] `https://<receiver-host>/healthz` returns `200`.
- [ ] Receiver root returns the candidate build; an unknown path returns `404`.
- [ ] Development and production applications point to their correct stable
      HTTPS URLs in the Google Cast SDK Developer Console.
- [ ] Test-device serials are registered for the unpublished development app.
- [ ] `CAST_RECEIVER_APP_ID`, `CRATE_CAST_RECEIVER_APP_ID` and
      `VITE_CAST_RECEIVER_APP_ID` resolve to the same non-default ID.
- [ ] Default Media Receiver fallback remains available with the custom flag
      disabled.

## Web sender on physical receiver

- [ ] Launch and first audio start.
- [ ] Artwork, title, artist, album and quality render correctly.
- [ ] Play, pause, seek, previous, next and volume remain in sync.
- [ ] Full queue continues after the browser sleeps or closes.
- [ ] Reconnect adopts receiver item/time without restarting playback.
- [ ] Add, remove, reorder, repeat and shuffle survive one revision conflict.
- [ ] Disconnect leaves playback running.
- [ ] Stop Cast stops playback and revokes the lease.
- [ ] Unsupported source format prepares and recovers from `425`.
- [ ] Missing artwork and missing spectrum use their fallbacks.
- [ ] Spectrum aligns after play, pause, seek, resume and item transition.

## Capacitor senders

Repeat launch, transport, queue continuation, reconnect, Disconnect and Stop
Cast from each native sender.

| Sender  | Device / OS | App build | Result | Evidence |
| ------- | ----------- | --------- | ------ | -------- |
| Android |             |           |        |          |
| iOS     |             |           |        |          |

- [ ] Android discovers the registered receiver and restores its Cast session.
- [ ] iOS local-network permission/discovery works on a physical iPhone.
- [ ] Native and Web senders emit the same queue/custom-message semantics.

## Appearance and accessibility

Verify at 1920×1080 and 1280×720, including overscan.

- [ ] Default skin: light and dark.
- [ ] Crate Red: light and dark.
- [ ] Long title/album and three-item queue remain readable.
- [ ] Missing artwork fallback remains bounded.
- [ ] Reduced motion freezes non-essential animation.
- [ ] Paused spectrum is stable and seek moves directly to the correct frame.

## Security and observability

- [ ] Invalid, expired, revoked and non-member leases fail closed.
- [ ] Range and `If-None-Match` CORS preflights succeed from the receiver.
- [ ] Sentry receives startup/load/recovery failures under the receiver release.
- [ ] Sentry events and logs contain no lease, query string, bearer token,
      title, artist, album, track ID or queue payload.
- [ ] Spectrum metrics distinguish ready, queued, generating and fallback.

## Rollout and rollback

- [ ] Deploy receiver/API with custom selection disabled and verify health.
- [ ] Enable and validate development app ID.
- [ ] Publish/validate production app ID, then build matching senders.
- [ ] Enable production custom receiver and watch launch/load/buffer/error rates.
- [ ] Confirm rollback switches senders to `CC1AD845` without a DB rollback and
      keeps the previous receiver image available during the lease window.

Final decision: **PASS / FAIL**

Open blockers:

-
