# Tauri Linux desktop validation — 2026-09-30

## Run identity

- Branch: `feat/tauri-desktop-app`
- Baseline revision: `00c988e9539269d105dddd5c65fcd8ee8dcdb252`
- The R03–R05 follow-up first ran against the working-tree path optimization, which is included in commit `7f79f2ed`.
- The checkout had no product changes before the initial acceptance run. Generated formatting changes in vendored Tauri permission files were reverted after both runs.
- Session: real logged-in CachyOS desktop on GNOME Wayland, not a VM, container, or Xvfb.
- Scope: release AppImage smoke, native loopback probes, MPRIS Play/Pause, and process memory sampling. The follow-up below also includes a Tauri filesystem path-resolution optimization and a rerun of R03–R05.

## Host

- CachyOS rolling, x86_64; kernel `7.2.8-1-cachyos`
- GNOME Shell `50.5`; `XDG_SESSION_TYPE=wayland`
- GTK `3.24.52`; WebKitGTK `2.52.6` (the bundle declares Linux WebKitGTK `>= 2.40.0`)
- Intel Arc Graphics (MTL), Mesa `26.2.3`; `glxinfo` reported direct rendering enabled
- PipeWire `1.6.9` with PulseAudio compatibility
- 30 GiB RAM and 30 GiB swap. Before audio probes, about 20 GiB RAM was available and 25 GiB swap was occupied. No swap was cleared and no unrelated process was stopped.
- Local `test-music/` had no audio files. Audio fixtures were synthetic tones generated in `/tmp` and removed after the runs.
- `playerctl` was unavailable; MPRIS was exercised with `busctl` and PipeWire state was read with `pactl`.
- The available desktop automation exposed no native windows, so window navigation, rapid scroll, resize, minimize/restore, HiDPI moves, screenshots, and offline UI actions could not be driven here.

## Gate summary

| Gate                                                         | Result                       | Evidence / limitation                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R01 HTTP client pool                                         | **Inconclusive**             | Full benchmark completed, but shared-client requests show a repeatable ~41 ms local delay that appears tied to the fixture's TCP behavior. Do not treat this as a production/API comparison.                                                                                                                                               |
| R03 hydration and file verification                          | **Pass after follow-up fix** | Three 5,000-entry hydration passes completed in 71–95 ms; three file-verification runs validated all 5,000 files.                                                                                                                                                                                                                          |
| R04 concurrent verification callers                          | **Pass**                     | Two simultaneous 1,000-file callers returned all 2,000 valid results. Median was 68 ms concurrent and 78 ms sequential in this synthetic probe.                                                                                                                                                                                            |
| R05 durable index writes                                     | **Pass**                     | Coalesced writes persisted all tested 100/1,000/5,000-entry indexes; paired 1,000-mutation runs also persisted all entries.                                                                                                                                                                                                                |
| R07 visualizer frames, CPU/RSS, visibility and DPR           | **Partial**                  | Three visible runs and RAF stop check completed. The probe measured 23–24 ms median frame intervals; the user reports the visualizer is still sluggish on an i9 Wayland desktop. Tauri Linux hides the visualizer until frame pacing is fixed. Hide/restore, resize, scaling changes, and the installed player's renderer remain untested. |
| R08 decoded audio RSS                                        | **Partial**                  | One- and two-track synthetic runs completed, including 90-second holds and at least 90 seconds after release. No real library track, crossfade, track-change race, or 60–120-minute fixture was available.                                                                                                                                 |
| AppImage launch                                              | **Partial**                  | Isolated release AppImage started in the normal desktop session and registered on D-Bus. In-app visual/version diagnostics could not be inspected.                                                                                                                                                                                         |
| MPRIS Play/Pause                                             | **Pass, limited**            | Status changed to Playing, position advanced 38→42 seconds, and Pause returned Paused at 42 seconds. A later SIGINT-driven app relaunch reported position 0, so persisted-position behavior is inconclusive. Next/previous, seek, metadata/artwork, and actual minimize/restore were not tested.                                           |
| Auth persistence, offline download/cancel/reconcile, upgrade | **Pending**                  | Requires interactive app/provider access and user-library actions; no such flows were exercised.                                                                                                                                                                                                                                           |
| WebKitGTK 2.40, X11, N−1 upgrade, other OSes                 | **Pending**                  | This host has WebKitGTK 2.52.6 and Wayland only.                                                                                                                                                                                                                                                                                           |

## AppImage smoke

Linux bundling initially stopped in `linuxdeploy`: its bundled `strip` rejected the host ELF `.relr.dyn` sections. `dpkg-deb` is not installed, so this run produced an AppImage only. Rebuilding with `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1` completed; `NO_STRIP` is the documented linuxdeploy workaround ([linuxdeploy issue #72](https://github.com/linuxdeploy/linuxdeploy/issues/72)).

- Product: `Crate Linux Acceptance`, version `0.1.0`
- Isolated identifier: `app.cratemusic.crate.desktop.acceptance20260930`
- Artifact: `app/listen-desktop/src-tauri/target/release/bundle/appimage/Crate Linux Acceptance_0.1.0_amd64.AppImage`
- SHA-256: `5c5530942f1ac7f8db4020415e568186dcbe5f56f0a9f3349905f08afe3d1166`
- Launch evidence: process started in the regular GNOME Wayland session and registered an MPRIS D-Bus name. The app's visible version screen, WebKit runtime panel, and WebGL panel were not inspected.

The isolated app shared the hard-coded `org.mpris.MediaPlayer2.crate` name with the development app, so it displaced the development app's MPRIS owner while open. It was closed and the normal app restarted; an early post-restart check showed `Paused` at 42 seconds. After the later probe cleanup and another SIGINT-driven restart, the final check showed `Paused` at 0 seconds. That stop path was not a normal native-window close, so persisted-position behavior remains inconclusive. Keep future isolated desktop probes sequential with the real app.

## R01 — HTTP client pool

Command: `cargo run --release --example http_pool_bench` from `app/listen-desktop/src-tauri`. The loopback HTTP/1.1 fixture returns 16 KiB per response. Timings are total / p50 / p95; connection counts exclude the shared client's warmup request.

| Concurrency | Requests |             Fresh client |                      Shared client | Connections: fresh / shared |
| ----------: | -------: | -----------------------: | ---------------------------------: | --------------------------: |
|           1 |      100 |   11 ms / 79 µs / 100 µs |   4,122 ms / 40,998 µs / 42,016 µs |                     100 / 0 |
|           1 |    1,000 |    57 ms / 40 µs / 46 µs |  41,279 ms / 41,007 µs / 42,031 µs |                   1,000 / 0 |
|           1 |    5,000 |   286 ms / 39 µs / 47 µs | 206,332 ms / 41,002 µs / 42,021 µs |                   5,000 / 0 |
|           8 |      100 |   6 ms / 265 µs / 690 µs |        532 ms / 217 µs / 40,968 µs |                     100 / 7 |
|           8 |    1,000 |  54 ms / 268 µs / 332 µs |      5,157 ms / 239 µs / 41,030 µs |                   1,000 / 7 |
|           8 |    5,000 | 268 ms / 261 µs / 330 µs |     25,792 ms / 222 µs / 41,021 µs |                   5,000 / 7 |

The ~41 ms tail repeats across request counts. The fixture writes response headers and body in separate writes and does not set `TCP_NODELAY`; that local server behavior is a likely contributor, but this run did not isolate it. The same benchmark looked materially different in the macOS handover. Treat R01 as inconclusive until the fixture is corrected or its delayed-ACK behavior is ruled out. Raw captured output: `/tmp/tauri-http-pool-bench-00c988e9.txt`.

## R03–R05 — native offline probe

The initial run stalled at 5,000 entries because the Tauri filesystem adapter called `@tauri-apps/api/path` `join` for every asset. That helper sends each join over Tauri IPC. The follow-up change now resolves `appLocalDataDir()` once and joins validated relative asset paths locally with the host's path separator. The probe now posts phase progress as well as final results.

The updated probe ran in a dedicated Tauri app identifier and isolated app-local storage on the same CachyOS GNOME Wayland host. Hydration first-pass times (three repetitions) were:

| Assets | Median |    Range | Warm median |
| -----: | -----: | -------: | ----------: |
|    100 |   7 ms |  5–30 ms |        0 ms |
|  1,000 |  20 ms | 19–37 ms |        0 ms |
|  5,000 |  86 ms | 71–95 ms |        0 ms |

All three 5,000-file verification runs validated all 5,000 files, with a median of 161 ms. Two concurrent callers each verified 1,000 files and returned 2,000 valid results; median elapsed time was 68 ms versus 78 ms sequential. Coalesced index writes persisted all 100, 1,000, and 5,000 entries (median 13, 44, and 870 ms). The paired 1,000-mutation case persisted all entries, with a 10 ms p95 commit latency.

This confirms the hydration stall is fixed on this Linux host and clears R03–R05 for the synthetic workload. It does not replace real offline download, cancellation, upgrade, and playback checks in the installed app. The probe cleaned up its isolated `offline-media` and `offline-meta` directories; no user offline data was touched. Raw progress and results: `/tmp/tauri-native-perf-results-hydration-fix.jsonl`.

## R07 — visualizer

Three automatic visible runs each lasted 30 seconds. The canvas was 720×720 CSS pixels at DPR 2 and rendered at 1,024×1,024 pixels, consistent with the configured buffer cap. All runs reported WebGL 2.0. Frame intervals were:

| Run       | Frame count |   p50 |   p95 |   Max | Synchronous tick p95 |
| --------- | ----------: | ----: | ----: | ----: | -------------------: |
| visible-1 |       1,156 | 24 ms | 39 ms | 62 ms |                 1 ms |
| visible-2 |       1,200 | 24 ms | 38 ms | 45 ms |                 1 ms |
| visible-3 |       1,202 | 23 ms | 37 ms | 45 ms |                 1 ms |

The sample median was 16% CPU for the Tauri/WebKit process group (p95 28%, max 44%). Median/max RSS by process: Tauri 136.7/137.5 MiB, WebKit Web 173.4/175.6 MiB, and WebKit Network 49.0/51.1 MiB. The sampled summed RSS median/p95/max was 359.1/364.1/364.2 MiB; RSS sums can double-count shared pages. Synchronous renderer tick p95 stayed at 1 ms, while RAF intervals centered around 24 ms, so this probe sees frame scheduling below 60 Hz but does not identify GPU completion time as the bottleneck.

The WebGL extension reported `Apple GPU` / `Apple Inc.` on Linux, while the host's `glxinfo` reported Intel Arc / Mesa 26.2.3. Treat the WebGL renderer string as unreliable on this host; it does not establish that an Apple GPU is in use. The explicit stop check passed: tick count stayed at 3,805 for two seconds. No visibility transitions were recorded because native window controls were unavailable.

Raw outputs: `/tmp/tauri-visualizer-linux.jsonl`, `/tmp/tauri-visualizer-linux-processes.txt`.

## R08 — decoded audio memory

Two local stereo FLAC tone fixtures were generated in `/tmp`; no library audio was copied or uploaded. They were decoded sequentially with a fresh Tauri process and `AudioContext.sampleRate=44,100 Hz`:

| Fixture       |            Duration | Encoded bytes |       Decoded PCM bytes |
| ------------- | ------------------: | ------------: | ----------------------: |
| track20       | 1,220.4 s (20:20.4) |    17,937,876 |             430,557,120 |
| track16       |   991.8 s (16:31.8) |    14,789,860 |             349,907,040 |
| Both retained |           2,212.2 s |    32,727,736 | 780,464,160 (744.1 MiB) |

Both buffers were held for 90 seconds, cleared, and followed for about 109 seconds. The continuous 250 ms sampler began after both buffers were decoded, so it did not capture pre-decode baseline or the earliest peak. It measured a maximum process-group 1,195 MiB RSS / 1,037 MiB PSS; about 109 seconds after release it still measured roughly 1,162 MiB RSS / 1,002 MiB PSS. This is observed retention, not proof of a leak.

A second fresh process measured only track20. Its sampler began as the Tauri process appeared and ran 205 seconds, ending about 111 seconds after release. Maximum process-group memory was 1,739 MiB RSS / 1,585 MiB PSS; WebKit Web maximum was 1,492 MiB RSS / 1,438 MiB PSS. After release, process-group memory stabilized at 850 MiB RSS / 689 MiB PSS, with WebKit Web at 608 MiB RSS / 546 MiB PSS. Most of the measured peak had fallen, but the remaining RSS/PSS stayed above initial startup levels. Allocator/WebKit retention remains a possible explanation.

These are synthetic development-WebView runs, not the installed player or a real track. No crossfade, seek, track-change-during-decode, 60–120-minute track, or repeated three-run sample was exercised. Do not use these results alone to change audio fallback policy or set a memory threshold.

Raw outputs: `/tmp/tauri-audio-rss-linux.jsonl`, `/tmp/tauri-audio-rss-linux-processes.jsonl`, `/tmp/tauri-audio-rss-single-linux.jsonl`, `/tmp/tauri-audio-rss-single-linux-processes.jsonl`.

## Real app observations and remaining work

- `busctl` MPRIS Play changed status to `Playing`; position advanced from 38 to 42 seconds over four seconds. Pause returned `Paused` and the position remained 42 seconds four seconds later. An early post-restart check also returned 42 seconds; after the final SIGINT-driven restart MPRIS returned `Paused` at 0 seconds. Session persistence was not established because these were development-process restarts, not a native-window close/reopen.
- During the paused state, `pactl` still showed a Crate sink input with `corked=false` (a second stream was corked). That does not by itself prove audible output; audio suspension should be checked with the real player and output device during manual QA.
- Startup emitted one GTK critical (`gtk_window_resize`, width must be greater than zero) and 96 WebKit/GStreamer video critical warnings (`gst_video_dma_drm_format_from_gst_format`, unknown video format). The app still opened; their effect on this audio-only run is unknown.
- The normal debug app was left open, with MPRIS registered and paused at position 0. To keep the working tree free of Tauri-generated formatting changes, the `tauri-dev` watcher was stopped after validation; the existing debug binary was started directly against Vite on port 5178. Frontend HMR is active, but this final app process does not have the Rust auto-rebuild watcher. Probe fixture files, isolated profile directories, and generated vendor formatting changes were cleaned up.
- Still required on this desktop: visually inspect route changes, rapid scroll/clicks, window transparency/click-through, resize/maximize/minimize/restore, visualizer hide/restore, offline download/cancel/reconcile/playback, queue/seek/gapless/EQ/output selection, and auth persistence/OAuth. Provider access and native UI automation were unavailable during this run.
- Still required elsewhere: a WebKitGTK 2.40 host, X11, upgrade from the previous package, and Windows/macOS installed-player checks. This run does not close those gates.
