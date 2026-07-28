# Listen mobile physical-device matrix

This matrix is a release-blocking checklist for native Listen builds. It must
be completed against the exact signed candidate and compatible backend before
promotion beyond the internal cohort.

Do not record account names, tokens, OAuth callback URLs or local media paths.
Attach screenshots or redacted logs to the release evidence instead.

## Candidate

| Field                    | Value   |
| ------------------------ | ------- |
| App version / build      | Pending |
| Commit                   | Pending |
| Backend version          | Pending |
| Test node                | Pending |
| Tester / date            | Pending |
| Automated mobile CI      | Pending |
| Signed artifact checksum | Pending |

`Pending` is not a pass. A release remains blocked until every P0 row is
recorded as `Pass` on the required platforms.

## Platforms

| ID  | Required target                                    | Device / OS | Result  |
| --- | -------------------------------------------------- | ----------- | ------- |
| A24 | Android API 24 physical device or release emulator | Pending     | Pending |
| AC  | Current Android physical device                    | Pending     | Pending |
| CA  | Chrome Android on the current physical device      | Pending     | Pending |
| IP  | Current supported iPhone                           | Pending     | Pending |
| ID  | iPad when the release declares iPad support        | Pending     | Pending |

## Authentication and identity

Run the applicable rows on A24, AC and IP. Repeat server switching on AC and
IP with a first-party and a self-hosted HTTPS node.

| Priority | Scenario                                                          | A24 | AC  | IP  | Evidence |
| -------- | ----------------------------------------------------------------- | --- | --- | --- | -------- |
| P0       | Password login from a clean install                               |     |     |     |          |
| P0       | Google/Apple OAuth cold-start callback and one-time code exchange |     |     |     |          |
| P0       | Upgrade migrates the existing token to Keystore/Keychain          |     |     |     |          |
| P0       | Home, followed artists, liked tracks and saved albums match web   |     |     |     |          |
| P0       | Followed playlists match web                                      |     |     |     |          |
| P0       | Switch server without leaking credentials or media tickets        |     |     |     |          |
| P0       | Expired access token refreshes without an empty-state flash       |     |     |     |          |
| P0       | Logout/revocation clears secrets and protected cached state       |     |     |     |          |
| P1       | Disabled exchange shows a recoverable compatibility error         |     |     |     |          |

The Collection parity row must exercise both routing paths: playlists are
served by FastAPI, while Home and the artist/album/track user collections may
be served by the Go readplane.

## Playback, background and routes

| Priority | Scenario                                                        | A24 | AC  | CA  | IP  | Evidence |
| -------- | --------------------------------------------------------------- | --- | --- | --- | --- | -------- |
| P0       | Two tracks advance without a duplicate skip or stalled queue    |     |     |     |     |          |
| P0       | Lock-screen controls and metadata survive a track transition    |     |     |     |     |          |
| P0       | Bluetooth/car controls survive a track transition               |     |     |     |     |          |
| P0       | Pause/resume after backgrounding has no pop or stale playback   |     |     |     |     |          |
| P0       | Android HTTPS playback sends bearer auth without query secrets  |     |     | NA  | NA  |          |
| P0       | Offline track starts with the server unavailable                |     |     |     |     |          |
| P0       | Process death restores safe queue metadata without stream URLs  |     |     | NA  |     |          |
| P1       | Noisy-audio/headset removal pauses predictably                  |     |     |     |     |          |
| P1       | AirPlay/output route selection updates without losing the queue | NA  | NA  | NA  |     |          |

## Offline, artwork and sharing

| Priority | Scenario                                                       | A24 | AC  | IP  | Evidence |
| -------- | -------------------------------------------------------------- | --- | --- | --- | -------- |
| P0       | Album download pauses in background and resumes in foreground  |     |     |     |          |
| P0       | Integrity mismatch is removed and repaired on the next sync    |     |     |     |          |
| P0       | Download concurrency remains bounded and UI remains responsive |     |     |     |          |
| P0       | Album and artist artwork render on Home and Collection         |     |     |     |          |
| P1       | Lock-screen artwork is sharp and memory remains bounded        |     |     |     |          |
| P1       | Cast discovery is visible only when the native SDK is present  |     |     |     |          |
| P1       | Instagram story generation restores UI after success/failure   |     |     |     |          |

## Install, upgrade and rollback

| Priority | Scenario                                                                   | A24 | AC  | IP  | Evidence |
| -------- | -------------------------------------------------------------------------- | --- | --- | --- | -------- |
| P0       | First stable-signed Android install documents the one-time debug uninstall |     |     | NA  |          |
| P0       | Stable-signed release upgrades the previous stable-signed candidate        |     |     |     |          |
| P0       | Cold-start deep link reaches the exact OAuth callback                      |     |     |     |          |
| P0       | Backend exchange flag rollback leaves existing sessions working            |     |     |     |          |
| P1       | Reinstall produces a new device-local credential envelope                  |     |     |     |          |

The first production-signed Android build cannot update a previously
debug-signed beta because Android requires matching signing identities. That
transition must fail safely, then succeed after one documented
uninstall/reinstall. Verify that server-side library data is preserved and
warn that device-local offline downloads and app settings are removed. Every
later candidate signed by the stable release key must upgrade in place.

## Sign-off

Release sign-off requires:

1. all P0 rows green;
2. no unexplained crash, ANR, playback transition or auth failure;
3. automated gates green on the same commit;
4. signed artifact checksums attached to the release;
5. the previous compatible client and the OAuth exchange kill switch kept
   available throughout the rollback window.
