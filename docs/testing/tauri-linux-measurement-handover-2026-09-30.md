# Tauri Linux measurement and acceptance handover

## Objective

Run the Linux native measurements and installed-app checks that are still open
for the Tauri hardening work. Use the pushed `feat/tauri-desktop-app` branch
from this handover and record the exact commit SHA in the results. Do not change
audio fallback policy or visualizer quality from one machine's measurements.

The branch declares Linux support with WebKitGTK 2.40 or newer. A prior Debian
12 ARM64 run used WebKitGTK 2.50.6 in an OrbStack VM under Xvfb with software
rendering. A packaged release opened there, but that run did not test a normal
desktop session, an accelerated GPU, or the 2.40 floor. Its RSS data is in
[`tauri-hardening-validation-2026-09-30.md`](tauri-hardening-validation-2026-09-30.md).

## Record the host first

Use a normal logged-in desktop session, not Xvfb, for acceptance. Record:

- Commit SHA, distribution and release, kernel, architecture, RAM, and power
  source.
- `XDG_SESSION_TYPE` (Wayland or X11), desktop/compositor, audio server, GPU,
  driver, and whether WebKit uses hardware acceleration.
- WebKitGTK version (`pkg-config --modversion webkit2gtk-4.1`), GTK version,
  and installed package type (deb, rpm, or AppImage).

Useful read-only commands:

```bash
git rev-parse HEAD
cat /etc/os-release
uname -a
printf 'session=%s\n' "$XDG_SESSION_TYPE"
pkg-config --modversion webkit2gtk-4.1
ps -eo pid,ppid,%cpu,rss,etime,comm,args | rg 'crate-desktop|WebKit'
```

If available, also save `glxinfo -B` or the equivalent GPU diagnostic. Keep the
normal desktop's session bus and compositor active for MPRIS and minimize/
restore checks.

## R02 — Packaged HTTP resource cleanup

The plugin's Rust and frontend cleanup tests pass, and macOS has both a live
development-WebView soak and a release-mode packaged soak. Linux still needs a
runtime check against the vendored `tauri-plugin-http` patch. Use a disposable
measurement build with its own bundle identifier and window; do not replace or
reuse the installed Crate profile.

Expose a temporary Tauri command that returns
`webview.resources_table().names().count()`. Drive requests through the same
frontend wrapper used by the app (`fetch` from
`@tauri-apps/plugin-http`) against a loopback fixture. Match the packaged
macOS scenarios: consumed HTTP 200, consumed HTTP 500, connection refused,
bodyless HTTP 204, abort while a request is pending, and cancel after the first
streamed body chunk. Run 25 cycles per scenario (150 requests total), record
the count before and after each settled request, and require it to return to
the isolated window's baseline every time. Also record the final count and
any rejected or timed-out scenario.

Build and launch the release bundle/package on the normal desktop session.
Record the source SHA, bundle identifier, package type and SHA-256, vendored
plugin revision, WebKitGTK version, host facts, and raw scenario results. Sample
the Tauri and WebKit process RSS separately during the soak; RSS alone does not
prove resource cleanup. Keep the probe command/page out of the production
bundle. If the temporary Vite multi-page input or Rust command is needed,
restore those harness-only edits after the capture and verify `git status`.

## R07 — Visualizer frames, GPU and suspension

The isolated page uses the production `MusicVisualizer` and its real WebGL
renderer with a deterministic synthetic analyser. It does not play audio, call
the Crate API, or use a user profile. The 720 × 720 CSS canvas matches the
square visualizer in the player. The branch also preserves aspect ratio when
the DPR-scaled buffer reaches its 1,024-pixel cap.

The current R07 candidate pairs adjacent Gaussian bloom taps into fractional
linear-filtered samples. This reconstructs the original discrete kernel while
reducing the blur shader from nine texture reads to five per pass (50 instead
of 90 reads per pixel across ten passes). Re-run the probe on the i9 Wayland
host and compare frame-interval p50/p95 and per-process CPU with the recorded
23–24 ms frame median. Keep the Linux visualizer hidden unless the measured
frame pacing is smooth; a code-level reduction or a macOS result alone does
not meet that gate.

The candidate is included in source revision
`489a69097e17b32a38ab47e0b47d941fba4962bb`. Its tests and all CI workflows
pass, but the visualizer remains hidden on Linux until the host measurement
shows smooth frame pacing.

Start a loopback receiver and launch the probe from the repository root:

```bash
python3 -c 'from pathlib import Path; Path("/tmp/tauri-native-perf-empty").write_bytes(b"x")'
python3 app/listen-desktop/scripts/audio-rss/fixture_server.py \
  --track placeholder=/tmp/tauri-native-perf-empty \
  --port 18766 \
  --report-file=/tmp/tauri-visualizer-linux.jsonl

npm run --workspace=app/listen-desktop tauri:dev -- \
  --config scripts/native-perf/visualizer.config.json
```

The page starts three 30-second visible runs automatically. It posts frame
interval p50/p95/max, synchronous renderer tick p50/p95/max, DPR, canvas CSS
and render sizes, visibility transitions, WebGL renderer, and context
attributes to the JSONL file. At the end it stops the renderer and checks that
the animation-frame callback count stays unchanged for two seconds. The Tauri
window uses a dedicated benchmark identifier.

During the three runs, sample the app and its WebKit renderer/GPU processes at
one-second or finer intervals. Keep processes separate; Linux RSS sums can
double-count shared pages. A basic sampler is:

```bash
while true; do
  date -Is
  ps -eo pid,ppid,%cpu,rss,etime,comm,args \
    | rg 'crate-desktop|WebKitWebProcess|WebKitGPUProcess|WebKitNetworkProcess'
  sleep 0.25
done > /tmp/tauri-visualizer-linux-processes.txt
```

Record CPU and RSS for the Tauri process, WebKit web process, and GPU process
separately. Report the process-group sum only as an additional figure. Use the
desktop window controls to minimize and restore the benchmark window while it
runs; confirm `visibilityState` changes and that frame callbacks pause and
resume. This page instantiates `MusicVisualizer` directly, not the React
`useMusicVisualizer` hook; the hook's visibility lifecycle is covered by its
automated tests. The probe does not exercise the real audio player. Verify that
hook integration separately in the installed player. Resize the window and, if
possible, move it between displays with different scaling. Record each DPR and
buffer size. The probe measures JavaScript frame scheduling and synchronous GL
submission; it does not measure GPU completion time or per-process energy. Keep
the probe results as dev-WebView measurements, then separately exercise the
same visualizer in the installed player.

## R08 — Decoded audio RSS

Use local FLAC fixtures with known durations and channel/sample-rate metadata.
Do not commit or upload music files. Run each measurement in a fresh Tauri
process; measure one long track, two long tracks together, and a 60–120 minute
track if one is available. Include a real library track near 20 minutes when
permitted. Exercise crossfade, seek, a quick track change during decode, then
unload and wait at least 90 seconds.

The fixture server's default port for this probe is 18765. For example:

```bash
python3 app/listen-desktop/scripts/audio-rss/fixture_server.py \
  --track track20=/absolute/path/to/long-track.flac \
  --track track16=/absolute/path/to/second-track.flac \
  --port 18765 \
  --report-file=/tmp/tauri-audio-rss-linux.jsonl

npm run --workspace=app/listen-desktop tauri:dev -- \
  --config scripts/audio-rss/tauri.config.json
```

Use `?tracks=track20` for a single fixture and `&releaseAfterMs=90000` to keep
decoded buffers for 90 seconds before release. Record source duration, channels,
source sample rate, `AudioContext.sampleRate`, decoded PCM bytes, and peak/hold/
post-release memory. Sample the Tauri, WebKit web, GPU, and networking processes
separately, preferably with both RSS and `/proc/<pid>/smaps_rollup` PSS. Note
whether RSS falls after release; allocator retention is not proof of a leak.
Linux results complement the existing container measurements and do not set a
cross-platform fallback threshold. The hosted Windows Server 2025 synthetic
measurement is recorded below; equivalent real-player runs on Linux, Windows,
and macOS are still required before changing behavior.

## R01, R03–R05 — Native performance probes

Read `app/listen-desktop/scripts/native-perf/README.md` for the exact probe
commands and scope. The loopback probes make no Crate API calls and use only
synthetic metadata and disposable local files.

- **R01:** run `cargo run --release --example http_pool_bench` from
  `app/listen-desktop/src-tauri`, once in a fresh process. It measures shared
  versus fresh Reqwest clients against a local HTTP/1.1 fixture, not TLS or the
  production API. Record duration, p50/p95, connection count, and host.
- **R03:** measure hydration and native verification at 100, 1,000, and 5,000
  files. The OS page cache is not cold unless explicitly cleared by a controlled
  test; label process-cache and OS-cache conditions separately.
- **R04:** compare two 1,000-file verification callers run sequentially and in
  parallel. Confirm all files pass and record the peak concurrent native IPC
  calls.
- **R05:** record sequential full-snapshot writes, same-turn coalescing, and
  1,000 mutations committed in pairs. Report write count, bytes, p50/p95 commit
  latency, final JSON size, and peak CPU/RSS. Do not infer real download cadence
  from same-turn stress bursts.

The native probe cleans its dedicated `offline-media` and `offline-meta` test
directories. Verify its isolated app identifier before launch and leave the
installed Crate app and its data untouched.

## Installed Linux acceptance

Build and test the package available on the host in a normal desktop session.
Confirm the package metadata declares the supported WebKitGTK minimum and that
the actual runtime satisfies it. Record whether the package is deb, rpm, or
AppImage; do not treat a container or cross-build as installed acceptance.

Exercise and record:

- Fresh launch, login/OAuth callback where credentials and provider access are
  available, relaunch with a persisted session, logout, and close/reopen.
- Remote playback, seek, pause/resume, queue changes, gapless/crossfade, EQ,
  visualizer, and output-device change. Include suspend/resume if the host can
  perform it.
- Offline download, cancellation, restart/reconciliation, and playback from
  offline files. Confirm the UI does not silently claim offline availability
  before verification.
- MPRIS registration and controls through the desktop session bus. Test status,
  metadata/artwork, play/pause, next/previous, and seek where supported using
  `playerctl` or equivalent. Check both X11 and Wayland only if both sessions
  are available.
- Window resize, hide/minimize and restore, HiDPI buffer changes, WebGL context
  cleanup on player close, and background CPU after rendering stops.
- Upgrade from the previous packaged version when that artifact is available;
  verify the user's library/configuration remains readable.

Do not mark unavailable provider credentials, the exact WebKitGTK 2.40 floor,
the alternate display server, or an N−1 package as passed. State which host or
artifact would be needed to close each one.

## Results to return

Append results to the hardening validation report or return a short report with
the exact SHA, host facts, command lines, logs, and these outcomes:

| Gate                                           | Result          | Evidence / limitation                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R02 packaged HTTP resource cleanup             | Pass, synthetic | Linux release-mode probe returned the Tauri resource table to zero after 150 requests in Debian 12/Xvfb; Windows Server 2025 also passed all 150 requests with a zero baseline. This does not cover Windows 10 1803. See the [validation record](tauri-hardening-validation-2026-09-30.md#current-head-workflow-dispatch-revalidation--79258d93).                                                                                                        |
| R01 loopback client pool                       | Pass, synthetic | Corrected hosted Linux probe confirms connection reuse; the CachyOS fixture run showed delayed-ACK latency and is not a valid latency comparison. No API/TLS traffic was measured. See the [desktop results](tauri-linux-desktop-results-2026-09-30.md#r01--http-client-pool) and [validation record](tauri-hardening-validation-2026-09-30.md#r01--shared-http-transport).                                                                              |
| R03 hydration and verification                 | Pass, synthetic | CachyOS/Wayland and Windows Server 2025 both passed 5,000-entry hydration and verification. Real downloads and installed-app offline flows remain untested. See the [corrected Windows results](tauri-linux-desktop-results-2026-09-30.md#corrected-exact-head-windows-server-2025-revalidation--2026-10-01).                                                                                                                                            |
| R04 parallel callers                           | Pass, synthetic | Both hosts returned all results from two concurrent 1,000-file callers; this does not cover real download contention. See the [corrected Windows results](tauri-linux-desktop-results-2026-09-30.md#corrected-exact-head-windows-server-2025-revalidation--2026-10-01).                                                                                                                                                                                  |
| R05 durable writes                             | Pass, synthetic | Both hosts persisted coalesced and paired mutations. Real download cadence remains unmeasured. See the [corrected Windows results](tauri-linux-desktop-results-2026-09-30.md#corrected-exact-head-windows-server-2025-revalidation--2026-10-01).                                                                                                                                                                                                         |
| R07 frames, CPU/RSS, hide/restore, DPR         | Partial         | GNOME Wayland frame intervals were 23–24 ms; the user also reports sluggish playback on an i9. Tauri Linux hides the visualizer until it is smooth. Native visibility, HiDPI transitions, and installed-player rendering remain open. See the [desktop results](tauri-linux-desktop-results-2026-09-30.md#r07--visualizer).                                                                                                                              |
| R08 real audio RSS and release                 | Partial         | Synthetic one- and two-track probes completed, but no real library track, crossfade, track-change race, or long-track fixture was available. See the [desktop results](tauri-linux-desktop-results-2026-09-30.md#r08--decoded-audio-memory).                                                                                                                                                                                                             |
| Installed package launch and WebKitGTK version | Partial         | The AppImage opened in a real CachyOS/Wayland session on WebKitGTK 2.52.6; Debian 12/Xvfb later verified packaged `.deb`/RPM launches against WebKitGTK 2.40.3. Neither run covers an installed package on a physical minimum-version desktop. See the [desktop results](tauri-linux-desktop-results-2026-09-30.md#appimage-smoke) and [validation record](tauri-hardening-validation-2026-09-30.md#linux-webkitgtk-2403-package-and-appimage-launches). |
| Playback, offline, MPRIS, upgrade              | Partial         | MPRIS Play/Pause changed state during the Wayland run. Real output-route/player inspection, offline download/cancel/reconcile/playback, and previous-package upgrade remain open. See the [desktop results](tauri-linux-desktop-results-2026-09-30.md#real-app-observations-and-remaining-work).                                                                                                                                                         |
