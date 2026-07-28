# Listen mobile release gates

This document defines the minimum evidence required before publishing a Listen
Android or iOS release. A successful web build or a manually tested APK is not
enough.

## Baseline (2026-07-27)

| Check                           | Current baseline                                                        |
| ------------------------------- | ----------------------------------------------------------------------- |
| Capacitor build                 | Passes for Android and iOS asset sync                                   |
| Initial application JavaScript  | 162.78 kB gzip across 16 module scripts/preloads; hard budget 300 kB    |
| Largest lazy/runtime chunks     | stats 86.54 kB gzip, React 73.29 kB gzip, player 48.54 kB gzip          |
| Listen tests                    | 1,599 passing, 4 explicitly skipped                                     |
| Listen typecheck and ESLint     | Passing                                                                 |
| Android lint and JVM unit tests | Passing locally with JDK 21; enforced in CI                             |
| Android artifact                | Signed, R8/resource-shrunk APK and AAB on tag builds                    |
| iOS artifact                    | Simulator workspace build in CI; protected signed archive still pending |
| Physical-device matrix          | Not attached to releases                                                |

The baseline records known debt; it does not waive the release gates below.
The previous 81.57 kB monolithic icon chunk is split into route-loadable Solar
feature entry points; the largest icon feature is 21.80 kB gzip.

The 2026-07-27 dependency baseline uses Capacitor 8.4.2 and React Router
7.18.1. `npm audit --omit=dev` still reports:

- the React Router RSC action advisory, whose compatible fix requires the
  breaking React Router 8 upgrade; Listen is a client-only `BrowserRouter`
  application and does not expose RSC actions or a React Router server;
- `esbuild` through the shared UI build toolchain, which is not shipped or
  executed in the mobile runtime.

These are scoped exceptions, not silent waivers. Re-evaluate them when React
Router 8 is adopted or the build toolchain moves to a patched `esbuild`.

## Required automated gates

Every mobile release candidate must satisfy all of these checks for the exact
tagged commit:

```yaml
listen_typecheck: pass
listen_eslint: pass
listen_focused_tests: pass
capacitor_sync: pass
android_lint_debug: zero_errors
android_lint_release: zero_errors
android_unit_tests: pass
android_signed_release: pass
ios_simulator_build: pass
ios_artwork_downsample_contract: pass
ios_secure_session_keychain_contract: pass
ios_signed_archive: pass
direct_runtime_vulnerabilities_with_compatible_fix: 0
```

The focused suite must cover authentication/bootstrap, secure credential
storage, offline media, playback queue transitions, MediaSession ownership and
native output routing.

## Required physical-device evidence

Complete
[`listen-mobile-device-matrix.md`](./listen-mobile-device-matrix.md) and attach
its evidence to the GitHub release:

| Platform          | Required scenarios                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android app       | Fresh login, upgrade with an existing session, Home, followed artists, liked tracks, saved albums, artwork, two-track playback, pause/resume, lock screen, Bluetooth, offline track |
| Chrome Android    | Home/Collection parity, two-track playback, MediaSession metadata/actions, screen lock, Bluetooth                                                                                   |
| iOS app           | Fresh login, upgrade session, Home/Collection, artwork, playback, lock screen, AirPlay/Bluetooth, offline track                                                                     |
| Desktop web/Tauri | Playback and MediaSession regression smoke                                                                                                                                          |

For each scenario record device, OS version, application version, server
version and pass/fail. A failed P0 scenario blocks release.

## Artifact and rollout rules

- GitHub releases must contain signed, reproducible Android and iOS artifacts.
- Debug APKs may be attached only to prereleases and must be labelled as debug.
- Backend compatibility must be deployed before enabling a client that depends
  on a new auth or media contract.
- Roll out to an internal/beta cohort first, then expand only while auth,
  playback-start, transition and crash telemetry remain within the documented
  SLO.
- Keep the previous native artifact and compatible backend path available until
  the rollback window closes.
- Roll back the native OAuth handoff by disabling only
  `NATIVE_OAUTH_EXCHANGE_ENABLED`; never restore tokens to callback URLs or
  plaintext browser storage.
