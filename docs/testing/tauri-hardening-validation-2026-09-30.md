# Tauri hardening validation — 2026-09-30

## Scope and revision

- Branch: `feat/tauri-desktop-app`
- Baseline source revision for the original launch, R01–R05, and R08 captures: `df72643d229ad7b47908f183690f5a35294a8ddf`
- Follow-up source revision for automated gates and the initial R07 capture: `5d6ca6e2cd462cc469a9b81d95fbe2ec5f52687e` (R07 renderer code is from parent `00c988e9`); the live macOS HTTP resource-table soak below used `3a851e3bca9634660ee6441a39c60b19f62a8943`.
- Host: Mac17,2; macOS 27.0.1 (build 26A434), arm64, 16 GiB RAM; on AC power when checked after the run
- Approved support floors: macOS 11+, Windows 10 version 1803+, and Linux with WebKitGTK 2.40+
- Decision recorded: retain current audio behavior until native memory measurements exist for each OS; defer any long-track fallback decision.

This is an interim validation record. Its capture groups use the revisions listed above; they do not close the native acceptance matrix or R08.

## macOS launch and window smoke

A fresh release `.app` was built from this revision using `CRATE_DESKTOP_VERSION=2.7.4 npm run --workspace=app/listen-desktop tauri:build:app -- --config /tmp/tauri-current-isolated.json`. The isolated bundle identifier was `app.cratemusic.crate.desktop.hardening-smoke20260930`; its product name was `Crate Hardening Smoke`. The package reports version `2.7.4`, minimum macOS `11.0`, and arm64; `otool` confirms binary `minos 11.0`. The artifact verifier accepted both `.app` bundles in the macOS output directory as version `2.7.4`.

The smoke ran on macOS 27.0.1, not on the declared minimum. The app opened at `#/server-setup`. `Cmd+W` removed its window while its process remained alive; activating the isolated app restored the same setup screen. `Cmd+Q` ended the test process. The separate `/Applications/Crate.app` process was left untouched.

The `Crate Hardening Smoke` bundle above was not used for memory measurement. Separate release bundles with the probe page were built for macOS and Linux below. Those bundles exercise release-mode Tauri/WebKit without login, API traffic, saved profile state, or the real player; they do not close the installed-player acceptance gates.

## Same-revision automated gates

### CI confirmation on latest source revision — `0e921f66586a149b05b97d47605706fc76a0cd6a`

The exact-head [Build Desktop Apps workflow](https://github.com/thecrateapp/crate/actions/runs/36786733551) completed successfully on macOS, Windows, and Linux. The macOS job built and version-checked both ARM64 and Intel tester app bundles; Windows and Linux built their desktop bundles, and Linux passed the GLIBC 2.36 compatibility and artifact-version checks. The [Backend Tests](https://github.com/thecrateapp/crate/actions/runs/36786607204), [Frontend Tests](https://github.com/thecrateapp/crate/actions/runs/36786606943), [React Doctor](https://github.com/thecrateapp/crate/actions/runs/36786607134), and [PR Agent Review](https://github.com/thecrateapp/crate/actions/runs/36786603833) workflows also passed on this exact SHA. Build Android and Build iOS were skipped because PR #259 remains a draft. Focused local validation for the latest OAuth changes is recorded in the persistent-review follow-up below. This confirms C06 for `0e921f66`; it does not close installed OS/WebView, real-player, signing/notarization, minimum-version, or upgrade gates.

I downloaded and inspected both macOS ZIPs from that run. The ARM64 bundle SHA-256 is `3d4eab6573b6a9debcabbe730e31dae94584ddf9174cbc0201218b89c53c5dce`; the Intel bundle SHA-256 is `308282328ce8a6bd66183c8fc0a351720facf7639cfa02714ec2f80600558215`. Both `Info.plist` and Mach-O load commands declare macOS 11.0; the binaries are arm64 and x86_64 respectively, version `0.1.0`. Both have ad-hoc signatures with no Team ID, so this confirms support-floor metadata and architecture, not distribution signing or notarization.

On `df72643d229ad7b47908f183690f5a35294a8ddf`, Desktop Vitest passed 43/43; Listen passed 2,416 tests across 323 files with 4 existing skips; Rust macOS passed 48/48 and Clippy completed with `-D warnings`. Desktop and Listen typechecks, Listen ESLint, and both Vite production builds passed. The builds retain the existing 564.65 kB chunk warning; Node also prints its `module.register()` deprecation warning.

Follow-up validation on branch revision `5d6ca6e2cd462cc469a9b81d95fbe2ec5f52687e` passed Desktop Vitest 43/43, Listen 2,416 passed with 4 existing skips, Rust 48/48, Clippy `-D warnings`, and Listen/Desktop typechecks. GitHub `Build Desktop Apps` passed all three jobs: Linux and Windows bundle/version checks, plus the macOS tester-bundle build. `Build Android` passed its typecheck, lint, contract tests, and Android tests. The signed APK/AAB steps were skipped because this was a manual non-release run. `PR Agent Review` completed successfully. These workflows are linked to the exact revision above; the PR remains draft.

### CI confirmation on source revision — `575f4b4341f18eb80118b897eb6a5964452aeab2`

All six GitHub workflows passed against this exact head: [Build Desktop Apps](https://github.com/thecrateapp/crate/actions/runs/36742978292), [Build Android](https://github.com/thecrateapp/crate/actions/runs/36742977995), [Backend Tests](https://github.com/thecrateapp/crate/actions/runs/36742977975), [Frontend Tests](https://github.com/thecrateapp/crate/actions/runs/36742979128), [React Doctor](https://github.com/thecrateapp/crate/actions/runs/36742978304), and [PR Agent Review](https://github.com/thecrateapp/crate/actions/runs/36742956223). Desktop builds passed on Linux, macOS, and Windows. Linux produced AppImage, DEB, and RPM artifacts; the binary verifier accepted GLIBC 2.34 under the 2.36 ceiling, and the artifact verifier accepted DEB/RPM metadata plus the AppImage filename for version `0.1.0`. Android's `build-apk` job passed. Backend security scan, quality checks, all eight test shards, and coverage passed; frontend appearance and test jobs passed. PR #259 remains open as a draft. This closes C06 for this SHA; it does not close installed runtime, minimum-OS, signing, or release-upgrade acceptance.

### CI confirmation on current source revision — `c0cc0d44538aebeebe977396234000417480cef2`

The manually dispatched [Build Desktop Apps workflow](https://github.com/thecrateapp/crate/actions/runs/36776469753) completed successfully on macOS, Windows, and Linux. The pull-request frontend tests, appearance check, React Doctor, security scan, and PR Agent Review are green on this head. Backend quality, test shards, coverage, and Android build remain skipped by CI because PR #259 is still a draft; OAuth-focused backend tests were run locally as recorded below. A green bundle build does not replace installed-app or minimum-OS acceptance.

The Linux artifacts were downloaded from that run and inspected in a Debian 12 container. `dpkg-deb -f` reported `Package: crate`, `Version: 0.1.0`, and `libwebkit2gtk-4.1-0 (>= 2.40.0)`. The AppImage extracted successfully; its `.desktop` file contains no version field. The branch now extracts AppImages during Linux artifact verification and checks for the executable `usr/bin/crate-desktop` plus a launchable desktop entry. The payload check passed all 13 version-script tests and against the downloaded AppImage in a Debian 12 container. The AppImage's internal runtime version and installed launch remain open. SHA-256: AppImage `423f63f0f61a98b96978cc3ba6337e5f081fdafd154188969dc52b8076524385`; DEB `8dcc2144be78b4a5cd1603fadd3b270284b21e362ba05949d9f58d4027b75b65`; RPM `c8cd9aa962b568b76e7dd2f1a65c7eecbd1afaf4e1d88a5bc99a7082ce329575`.

### CI confirmation on current source revision — `8baf8c5cc28276356950e6be2427be25d2366324`

The manually dispatched [Build Desktop Apps workflow](https://github.com/thecrateapp/crate/actions/runs/36779952133) passed Linux, Windows, and macOS bundle jobs on this exact head. [Build Android](https://github.com/thecrateapp/crate/actions/runs/36779029181) and [Backend Tests](https://github.com/thecrateapp/crate/actions/runs/36779029012) also passed on this SHA, including Android tests plus backend quality, all eight test shards, and coverage. Frontend tests, appearance, React Doctor, security scan, and PR Agent Review passed as well. PR #259 remains a draft. This confirms C06 for this SHA; installed runtime, minimum-OS, signing, and upgrade checks remain separate.

### CI confirmation and cross-platform HTTP diagnostic — `a098d86690eefff146323caae8dd77b5083d94a0`

The manually dispatched [Build Desktop Apps workflow](https://github.com/thecrateapp/crate/actions/runs/36781473125) completed successfully on Linux, Windows, and macOS. Backend Tests, Frontend Tests, React Doctor, and PR Agent Review also passed on this exact SHA. Android and iOS PR build jobs were skipped because PR #259 remains a draft; Android passed on the previous code-equivalent source SHA `8baf8c5c`. The only changes after that source SHA were the diagnostic CI step and validation documentation. This confirms C06 for `a098d866`; installed runtime, minimum-OS, signing, and upgrade checks remain separate.

## macOS native performance measurements — R01, R03–R05

The offline probes used the recorded source revision on the Mac17,2 ARM64 host above. The corrected release HTTP microbenchmark first ran against a loopback HTTP/1.1 server on a checkout based on `2903365a`, then was repeated on source HEAD `8baf8c5c`. The offline probes ran in an isolated Tauri development window with synthetic metadata and 1-byte files under a dedicated app identifier. Timings are not production API or installed-player acceptance results.

### R01 — HTTP client reuse

`cargo run --locked --release --manifest-path app/listen-desktop/src-tauri/Cargo.toml --example http_pool_bench` compared a fresh reqwest client per request with one shared client. Each response contained 16 KiB. The fixture sets `TCP_NODELAY` and writes headers plus body together; the earlier Linux run's roughly 41 ms delay came from the fixture's delayed-ACK behavior, not production HTTP latency. These measurements repeat the corrected fixture on the Mac17,2 ARM64 host at source HEAD `8baf8c5c`. The shared client's accepted-connection count excludes the warmup request because the benchmark resets that counter after warmup.

| Concurrency | Requests | Fresh client: total / p50 / p95 | Shared client: total / p50 / p95 | Accepted connections: fresh / shared |
| ----------- | -------: | ------------------------------: | -------------------------------: | -----------------------------------: |
| 1           |      100 |            20 ms / 124 / 148 µs |                6 ms / 50 / 62 µs |                              100 / 0 |
| 1           |    1,000 |            162 ms / 77 / 122 µs |               34 ms / 28 / 34 µs |                            1,000 / 0 |
| 1           |    5,000 |            841 ms / 78 / 119 µs |              170 ms / 26 / 43 µs |                            5,000 / 0 |
| 8           |      100 |            19 ms / 219 / 365 µs |               1 ms / 85 / 175 µs |                              100 / 7 |
| 8           |    1,000 |           138 ms / 227 / 614 µs |              16 ms / 91 / 253 µs |                            1,000 / 7 |
| 8           |    5,000 |           744 ms / 299 / 527 µs |              90 ms / 96 / 224 µs |                            5,000 / 7 |

The corrected local fixture shows that pooling reuses keep-alive connections and lowers loopback latency in this run. The exact-head desktop CI workflow then ran the same probe on hosted Linux, Windows, and macOS runners. All results below are synthetic HTTP loopback measurements, not API or installed-app measurements. The shared-client connection count excludes its warmup request.

| OS (hosted runner) | Concurrency | Requests |     Fresh total / p50 / p95 | Shared total / p50 / p95 | Connections fresh / shared |
| ------------------ | ----------: | -------: | --------------------------: | -----------------------: | -------------------------: |
| Linux              |           1 |      100 |           4 ms / 30 / 38 µs |        1 ms / 11 / 12 µs |                    100 / 0 |
| Linux              |           1 |    1,000 |          42 ms / 29 / 33 µs |       13 ms / 11 / 11 µs |                  1,000 / 0 |
| Linux              |           1 |    5,000 |         209 ms / 29 / 33 µs |       62 ms / 11 / 11 µs |                  5,000 / 0 |
| Linux              |           8 |      100 |         5 ms / 249 / 355 µs |       1 ms / 87 / 185 µs |                    100 / 7 |
| Linux              |           8 |    1,000 |        48 ms / 234 / 281 µs |       14 ms / 79 / 97 µs |                  1,000 / 7 |
| Linux              |           8 |    5,000 |       244 ms / 237 / 287 µs |      74 ms / 78 / 206 µs |                  5,000 / 7 |
| Windows            |           1 |      100 |        34 ms / 235 / 271 µs |        5 ms / 40 / 50 µs |                    100 / 0 |
| Windows            |           1 |    1,000 |       331 ms / 236 / 286 µs |       33 ms / 28 / 33 µs |                  1,000 / 0 |
| Windows            |           1 |    5,000 |     1,690 ms / 248 / 294 µs |      168 ms / 27 / 36 µs |                  5,000 / 0 |
| Windows            |           8 |      100 |    24 ms / 1,051 / 1,583 µs |      4 ms / 179 / 880 µs |                    100 / 7 |
| Windows            |           8 |    1,000 |   242 ms / 1,025 / 1,506 µs |     29 ms / 172 / 211 µs |                  1,000 / 7 |
| Windows            |           8 |    5,000 | 1,468 ms / 1,209 / 1,955 µs |    144 ms / 173 / 211 µs |                  5,000 / 7 |
| macOS              |           1 |      100 |        51 ms / 165 / 501 µs |        7 ms / 60 / 80 µs |                    100 / 0 |
| macOS              |           1 |    1,000 |       468 ms / 152 / 408 µs |      82 ms / 57 / 144 µs |                  1,000 / 0 |
| macOS              |           1 |    5,000 |     2,099 ms / 150 / 329 µs |      327 ms / 55 / 76 µs |                  5,000 / 0 |
| macOS              |           8 |      100 |        21 ms / 337 / 491 µs |      2 ms / 124 / 279 µs |                    100 / 7 |
| macOS              |           8 |    1,000 |       254 ms / 400 / 700 µs |     23 ms / 143 / 172 µs |                  1,000 / 7 |
| macOS              |           8 |    5,000 |   1,442 ms / 447 / 1,002 µs |    217 ms / 173 / 706 µs |                  5,000 / 7 |

On each runner and request size, the shared client accepted zero new connections after warmup at concurrency one and seven at concurrency eight, while a fresh client opened one connection per request. Shared-client totals were lower in all six cases on each OS. This confirms keep-alive reuse in the fixture and supports keeping the shared client. It does not measure TLS, proxy behavior, Crate API routes, CPU/RSS, cancellation, or installed-app traffic; those R01 acceptance checks remain open. See the exact [workflow run](https://github.com/thecrateapp/crate/actions/runs/36781473125) for the raw runner output.

### R03 — Offline index hydration and file verification

Three repetitions per size loaded profile indexes containing 100, 1,000, and 5,000 entries. The first pass used a new profile cache but the OS file cache was not cold; the immediately repeated same-process pass was below 1 ms at every size. Median first-pass hydration was 11 ms, 94 ms, and 456 ms. Each first profile load invoked `reconcile_offline_media` once; the warm cache pass invoked no Rust command. The timing includes metadata parsing and locator hydration, but the instrumentation did not count every `plugin-fs` read IPC.

The probe also verified 1-byte local files through the production `verifyNativeOfflineAssets` adapter. All files passed size/existence checks in all three runs. At the 500-asset batch size, the adapter made 1, 2, and 10 native IPC calls for 100, 1,000, and 5,000 assets; median elapsed times were 5 ms, 43 ms, and 220 ms. Ten batch commands overlapped in the 5,000-file case. The Rust semaphore still bounds file inspections to eight; its per-file in-flight count was not instrumented here, and the Rust unit tests cover that bound.

### R04 — Concurrent verification callers

Two callers each verified 1,000 files, three repetitions. Sequential execution took a median 93 ms; concurrent callers took 84 ms and overlapped at most four verification IPC commands. This small difference does not justify changing the global limit of eight. The benchmark checks throughput and results, while the Rust tests remain the evidence for the inner file-task cap.

### R05 — Durable index writes

A temporary observer in the Tauri filesystem adapter counted the UTF-8 payload written for the index `.next` file and timed each `writeTextFile`; the adapter was restored after measurement. These byte counts exclude JSON reads, metadata operations, and rename traffic.

Three repetitions of 100 sequential full-snapshot saves produced 100 durable writes, 623,435 payload bytes in total, and a median elapsed time of 544 ms. Coalescing 100 same-turn mutations into one flush produced one 12,671-byte index write in 6 ms median. Same-turn bursts of 1,000 and 5,000 mutations also produced one durable write each: 130,671 bytes in 16 ms and 666,671 bytes in 211 ms median. The burst case is a stress ceiling because real download completions do not all arrive in one JavaScript turn.

The more representative two-at-a-time run applied 1,000 mutations in 500 durable commits, three repetitions. It took 2,360 ms median, wrote 32,157,410 index-payload bytes total (30.7 MiB), and ended with a 128,671-byte index. Per-commit latency was 5 ms p50 and 6 ms p95; the underlying `writeTextFile` p95 was 1 ms. This confirms that batching halves the number of full-index commits at download concurrency two, while the full JSON snapshot still creates cumulative write amplification. Keep the current durable JSON writer for now; deciding on a journal needs Linux and Windows measurements plus real download completion cadence and an agreed latency/write budget.

The reproducible probes and exact commands are in [`app/listen-desktop/scripts/native-perf/`](../../app/listen-desktop/scripts/native-perf/README.md). R01 and R03–R05 remain open for Linux/Windows and real API/download workloads.

### R02 — HTTP plugin resource cleanup revalidation — `5d6ca6e2`

The vendored `tauri-plugin-http` resource tests passed 2/2: the cleanup helper returns all three request resources to baseline, and cancellation signals the pending request while releasing those resources (including repeated cancellation). The frontend plugin wrapper tests passed 3/3 for bodyless `204` cleanup, cancellation of a partially consumed body, and abort-listener removal when response headers fail.

An isolated macOS Tauri development WebView on branch revision `3a851e3b` then exercised the plugin against a loopback fixture with a temporary command that read the live `ResourceTable` count. Twenty-five cycles each covered a consumed 200 response, consumed HTTP 500 response, connection-refused request, bodyless 204, abort during a delayed request, and cancellation after the first chunk of a stream: 150 requests total. The baseline was zero resources; the count returned to zero after every request, with no failed checks. The raw JSON result is `/tmp/tauri-http-resource-macos-20260930.json`. The probe page and counter were removed after the run.

This closes the live development-WebView soak on macOS. A follow-up release-mode packaged-app soak used a dedicated probe bundle built from branch source revision `856de16c` with a temporary probe page and resource-count commands; the production Tauri/plugin code was unchanged. The bundle was arm64, version `2.7.4`, minimum macOS `11.0`, and intentionally unsigned/notarized. Across 25 cycles of the same six scenarios (150 requests), the live resource count returned to zero after every settled request: baseline/minimum/maximum/final were all zero, with no failed checks. The binary SHA-256 was `adc11bcdeec9801f8b604d038ec560721682a432e184e3c29a29cbf03758969b`.

During the 14.37-second packaged soak, 83 RSS samples of the main Tauri process ranged from 15.4 MiB to 105.9 MiB (median 63.0 MiB, p95 101.4 MiB); the last sample was 47.7 MiB. This sample covers only the main process, not WebKit subprocesses, and the short isolated loopback soak is not real playback or API traffic. Structured host, bundle, request, and RSS evidence is in [`tauri-r02-macos-release-2026-09-30.json`](measurements/tauri-r02-macos-release-2026-09-30.json). The temporary page and commands were removed after the run.

R02's macOS live development and packaged WebView soaks are now recorded. Packaged runtime checks on Windows and Linux remain open.

### R06 — Media session por diferencias

`useMediaSession` still submits a full snapshot each second, but `syncDesktopMediaSession` compares a key containing track identity, title, artist, album, and artwork. It calls `update_desktop_media_session` only when that key changes; playback state and timeline use `update_desktop_media_playback_state` and `update_desktop_media_position` separately. That prevents Windows from repeating `ClearAll`/thumbnail loading/`Update` on position ticks and prevents those ticks from publishing Linux metadata. The focused `desktop-tray` and tray-command suites passed 21/21 tests on `c0cc0d44`. R06 is resolved in code; actual OS media-center behavior remains part of the installed-player gates below.

## macOS visualizer measurement — R07

Three visible 30-second Tauri development WebView runs used the production `MusicVisualizer`, a deterministic synthetic analyser, and the Apple GPU (`WebGL 2.0`, `Apple Inc.`). With the initial wide probe canvas at 1,231 × 720 CSS pixels and DPR 1, the buffer was capped independently at 1,024 × 720. Each run reported frame-interval p50 17 ms and p95 18 ms; max intervals were 203, 31, and 25 ms. The first run included a brief hidden/visible transition; the two later runs stayed near 60 Hz. Synchronous renderer tick p95 was at or below the WebView's roughly 1 ms timer resolution. This records scheduling and CPU-side GL submission, not GPU completion time.

During the first 30 seconds of a repeat, sampled `ps %cpu` across the Tauri, WebKit GPU, WebContent, and Networking processes averaged 13.3% as a group (sample p95 18.5%; max 31.5%). Summed RSS had median 75.8 MiB, sample p95 94.8 MiB, and max 114.5 MiB. Per-process RSS medians/maxima were: Tauri 36.0/38.2 MiB; WebKit GPU 13.6/17.7 MiB; WebContent 21.4/47.5 MiB; Networking 6.1/11.1 MiB. RSS sums can double-count shared pages, and `ps %cpu` is only a sampled proxy; neither is an energy measurement. An explicit stop check observed no additional renderer ticks for two seconds.

The capped-size measurement exposed an aspect-ratio defect: clamping width and height independently stretched non-square canvases. `getVisualizerRenderSize` now applies one scale factor to both dimensions. The regression changed the DPR-2 resize expectation from 1,024 × 1,024 to 1,024 × 768; it failed before the fix. The renderer and hook suites pass 59/59, with Listen typecheck and focused ESLint green.

After that fix, three visible runs at the final 720 × 720 CSS size and DPR 1 recorded frame-interval p50/p95/max of 17/17–18/18–26 ms, 17/17/18 ms, and 17/17/24 ms. Synchronous tick p95 was 1 ms or less. A separate native window cycle stayed minimized for 8.59 seconds; the WebView reported hidden then visible, the interval maximum captured the 8.59-second pause, and the following two runs returned to p50/p95 17/17 ms. The stop check passed with an unchanged tick count over two seconds.

A 100-sample `top` delta capture at one-second intervals covered all three visible runs. Per-process CPU p50/p95/max was Tauri 4.5/5.5/6.7%, WebKit GPU 5.4/8.0/8.9%, WebContent 5.7/7.2/8.1%, and Networking 0/0.1/2.2%. A separate 0.5-second RSS capture across the same runs recorded median/p95/max MiB of Tauri 34.9/44.3/45.8, GPU 12.4/14.6/15.2, WebContent 17.5/21.5/24.4, and Networking 6.8/9.6/10.5. Keep process values separate; RSS can double-count shared pages, and these dev-WebView numbers do not measure energy or GPU completion.

This harness instantiates the production `MusicVisualizer` directly with a synthetic analyser; it does not mount `useMusicVisualizer` or run real audio. The hook's visibility behavior has automated coverage, while native minimize/restore here verifies WebView visibility and RAF suspension/resumption. R07 remains open for repeatable HiDPI runs, an installed-player smoke, and comparable release runs on macOS Intel, Windows, and a regular Linux desktop. Linux steps are in the [Linux measurement handover](tauri-linux-measurement-handover-2026-09-30.md).

### macOS HiDPI follow-up — 2026-09-30, branch revision `5d6ca6e2`

The probe window was placed on the external 5K display (5,120 × 2,880 pixels, 2,560 × 1,440 logical points). The native WebView reported DPR 2. At 720 × 720 CSS pixels, the production renderer allocated a 1,024 × 1,024 canvas, confirming the configured buffer cap on a Retina display. WebGL reported `Apple GPU`.

One uninterrupted visible 30-second run reported frame-interval p50/p95/max of 17/18/45 ms and synchronous tick p50/p95/max of 0/1/1 ms. The renderer stop check passed with an unchanged tick count over two seconds. Two later cycles recorded hidden/visible transitions and are not counted as clean visible runs; their frame maxima are not included here. The corresponding JSONL file is `/tmp/tauri-visualizer-macos-hidpi-20260930-r2.jsonl`.

The process CPU/RSS samplers started after the clean cycle and overlapped those interrupted cycles, so this capture does not provide valid per-process CPU/RSS for the DPR-2 run. The earlier DPR-1 three-run capture remains the CPU/RSS evidence. An installed-player integration check and clean repeated HiDPI runs remain open.

## macOS development WebView memory measurement

The probe was run in a fresh `crate-desktop` process on the host above. It fetched two local FLAC fixtures over loopback, decoded them sequentially with `AudioContext.decodeAudioData`, kept both `AudioBuffer`s for 90 seconds, then cleared the references and closed the context. The fixture page made no Crate API requests.

The WebKit `AudioContext` selected 44,100 Hz. The 20.34-minute stereo buffer contained 430,594,752 bytes of Float32 PCM (410.6 MiB); the 16.53-minute buffer contained 349,839,512 bytes (333.6 MiB). Together they retained 780,434,264 bytes (744.1 MiB). The sampler recorded process RSS every 250 ms from before app startup through 15 seconds after release. Its startup interval began before Tauri existed, so only the peak is useful for that phase. Apple `footprint` sampled the Tauri and WebKit process IDs every 500 ms for 125 seconds; its first sample began about 14 seconds after the two buffers were ready, while its per-process peak field covered the process lifetime.

| Phase                    | Process-group RSS summary                     | WebContent RSS summary         | Additional observation                                                                                                                   |
| ------------------------ | --------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Decode and startup       | Peak 1,132.2 MiB                              | Peak 961.7 MiB                 | Group peak sample: WebContent 939.1 MiB, Tauri 117.6 MiB, GPU 26.2 MiB, Networking 45.5 MiB, plus a 3.8 MiB pre-existing WebKit service. |
| 90-second buffer hold    | Min / median / max: 79.0 / 91.4 / 1,085.1 MiB | Median / max: 11.0 / 928.3 MiB | RSS drops sharply after the early decode samples although the page still retains both buffers.                                           |
| 15 seconds after release | Min / median / max: 94.6 / 102.3 / 104.7 MiB  | Median / max: 13.7 / 16.7 MiB  | The browser-visible buffer references were cleared and the context closed.                                                               |

RSS is only the resident portion. `footprint` reported a WebContent `phys_footprint_peak` of 1,096.9 MiB and about 971 MiB at its first post-decode sample. It remained about 971 MiB 48 seconds after release; at that point the sampled process group was 1,032.2 MiB total footprint, including 1,023.1 MiB reported as swapped. This explains why RSS alone fell to tens of MiB. It is an observed high-water/retention result, not proof of a leak: the probe leaves a closed `AudioContext` in the page and does not test reuse by the real player.

A separate earlier 48,000 Hz pass measured about 810.1 MiB of decoded PCM for the same two durations and approximately 828 MiB RSS in WebContent just after both decodes. That pass did not include the same complete sampler, so treat it as a comparison point rather than a directly comparable repeat. The output rate materially changes the decoded byte count; use the actual `AudioBuffer.sampleRate`, not only the source file rate.

The repeatable probe and local fixture server are in [`app/listen-desktop/scripts/audio-rss/`](../../app/listen-desktop/scripts/audio-rss/README.md). The saved harness was smoke-tested in Tauri with one 16.53-minute fixture: WebKit reported 44,100 Hz, 349,839,512 decoded bytes, and released the buffer after the configured one-second timer. These results came from a Tauri development WebView on macOS 27.0.1. They do not cover the real player, the macOS 11 floor, Intel macOS, 60–120-minute tracks, crossfade/three-buffer overlap, active playback, visualizer/EQ, or a 60-minute soak. Windows has not been measured. Release-mode macOS and Linux measurements are recorded below; R08 remains open and no fallback or byte budget is approved.

## macOS packaged release RSS measurement

A separate `.app` release bundle was built from the same revision with version `2.7.4`, product name `Crate Audio RSS macOS`, and isolated identifier `app.cratemusic.crate.desktop.audio.rss.macos20260930`. The bundle is arm64, declares `LSMinimumSystemVersion=11.0`, and `otool` confirms binary `minos 11.0`. It was launched from `target/release/bundle/macos` with `open -n`; it was not copied into `/Applications` or signed/notarized as a release. The test app used a measurement-only window and a loopback fixture server. The user's separate `/Applications/Crate.app` remained running and untouched.

The same 20.34- and 16.53-minute synthetic FLAC fixtures were decoded. This release WebView selected 48,000 Hz, so the buffers contained 468,633,600 bytes (446.9 MiB) and 380,851,200 bytes (363.1 MiB), 849,484,800 bytes total (810.1 MiB). A sampler started before launch and captured the Tauri process plus the newly started WebKit XPC processes every 250 ms for 210 seconds (707 samples), ending 110.3 seconds after release. RSS values below are MiB; process-group sums can count shared pages more than once.

| Phase                                               | Process-group RSS min / median / max | WebContent RSS min / median / max |
| --------------------------------------------------- | ------------------------------------ | --------------------------------- |
| Decode, from AudioContext creation to ready (2.2 s) | 177.4 / 755.2 / 1,333.0              | 29.1 / 617.7 / 1,125.7            |
| 90-second hold                                      | 86.3 / 89.9 / 1,130.0                | 17.2 / 19.1 / 1,002.5             |
| 0–15 seconds after release                          | 95.9 / 98.4 / 116.9                  | 15.9 / 18.4 / 24.8                |
| 15–30 seconds after release                         | 76.6 / 95.0 / 95.9                   | 8.2 / 15.6 / 15.9                 |
| 30–60 seconds after release                         | 73.7 / 75.7 / 77.3                   | 7.6 / 8.0 / 8.4                   |
| 60–110 seconds after release                        | 70.5 / 72.5 / 74.9                   | 5.1 / 6.4 / 7.1                   |

Low RSS during the hold and after release did not mean the decoded memory had disappeared. Around 84 seconds after release, a 10-second Apple `footprint` sample measured WebContent at 889.9 MiB with a lifetime peak of 1,341.5 MiB; total sampled process-group footprint was 943.7 MiB, including 938.6 MiB swapped. The OS had compressed/swapped most of the resident pages. This is a high-water/retention observation, not proof of a leak.

## Linux debug WebView RSS measurement (container)

A separate run used the same revision (`df72643d229ad7b47908f183690f5a35294a8ddf`) inside Debian 12 ARM64 on the local OrbStack Linux VM, with WebKitGTK 2.50.6. The VM reports 7.8 GiB RAM and no cgroup memory cap. Tauri ran as a debug build under Xvfb with software rendering and a private D-Bus session; no installed desktop shell, compositor, GPU acceleration, account, or Crate API was involved. This is a Linux/WebKitGTK runtime datapoint, not installed desktop acceptance, and it does not validate the declared WebKitGTK 2.40 minimum.

Two synthetic pink-noise FLAC fixtures were decoded at 44,100 Hz: 20.34 minutes (430,557,120 PCM bytes / 410.6 MiB) and 16.53 minutes (349,907,040 bytes / 333.6 MiB), 780,464,160 bytes total (744.1 MiB). The probe retained both buffers for 90 seconds and then cleared them and closed the AudioContext. A sampler started before Tauri launch and sampled the Tauri process plus its WebKit children every 250 ms for 210 seconds (823 samples). RSS values below are MiB; process-group sums can count shared pages more than once.

| Phase                                               | Process-group RSS min / median / max | WebContent RSS min / median / max |
| --------------------------------------------------- | ------------------------------------ | --------------------------------- |
| Decode, from AudioContext creation to ready (4.9 s) | 456.1 / 1,163.3 / 1,803.2            | 188.5 / 866.2 / 1,560.8           |
| 90-second hold                                      | 1,034.2 / 1,228.4 / 1,625.4          | 929.1 / 1,013.0 / 1,383.2         |
| 0–15 seconds after release                          | 1,049.4 / 1,052.4 / 1,052.5          | 943.6 / 945.3 / 945.4             |
| 15–30 seconds after release                         | 1,052.3 / 1,052.3 / 1,052.4          | 945.2 / 945.3 / 945.3             |
| 30–60 seconds after release                         | 1,013.9 / 1,014.2 / 1,052.3          | 931.0 / 931.2 / 945.2             |

The process group settled below 166.1 MiB (WebContent below 83.1 MiB) about 60.5 seconds after release; the final sample at 74.1 seconds was 165.6 MiB group RSS and 82.6 MiB WebContent RSS. The retained high RSS during the first minute is an allocator/WebKit retention observation, not proof of a leak. Unlike the macOS probe, this container run has no `phys_footprint` measure.

The macOS release WebView selected 48 kHz while both Linux runs selected 44.1 kHz, changing the PCM size for the same source durations. macOS RSS fell as the OS swapped/compressed pages while `phys_footprint` stayed high; Linux release RSS stayed near 899 MiB after release. These are single runs on different WebKit engines/hosts, and the Linux runtime is a container under Xvfb. Do not infer a fallback threshold from them. Windows and measurements with the real player remain required before deciding whether long tracks need a fallback.

## Linux packaged release RSS measurement

A measurement-specific Linux release `.deb` was built from the same revision as `crate-rss-linux` version `2.7.4`, architecture `arm64`, then installed with `dpkg -i` in the Debian 12 ARM64 container. Its package metadata declares `libwebkit2gtk-4.1-0 (>= 2.40.0)`; the runtime used WebKitGTK 2.50.6. The package opened successfully under Xvfb with software rendering and a private D-Bus session. This exercises the bundled release binary and WebKitGTK, but not a normal desktop shell/compositor or the declared 2.40 floor.

It decoded the same fixtures at 44,100 Hz and retained 744.1 MiB PCM for 90 seconds. The sampler started before launch and captured the app and its WebKit children every 250 ms for 210 seconds (824 samples), including 106.0 seconds after release. RSS values are MiB; process-group sums can count shared pages more than once.

| Phase                                               | Process-group RSS min / median / max | WebContent RSS min / median / max |
| --------------------------------------------------- | ------------------------------------ | --------------------------------- |
| Decode, from AudioContext creation to ready (4.9 s) | 413.0 / 984.5 / 1,717.6              | 169.5 / 692.4 / 1,486.3           |
| 90-second hold                                      | 1,242.5 / 1,270.3 / 1,982.3          | 1,020.3 / 1,041.1 / 1,751.1       |
| 0–15 seconds after release                          | 1,055.0 / 1,055.0 / 1,254.4          | 939.4 / 939.4 / 1,030.9           |
| 15–30 seconds after release                         | 1,055.0 / 1,055.0 / 1,055.1          | 939.4 / 939.4 / 939.5             |
| 30–60 seconds after release                         | 973.8 / 1,055.1 / 1,055.1            | 899.1 / 939.5 / 939.5             |
| 60–106 seconds after release                        | 961.5 / 973.8 / 973.8                | 894.2 / 899.1 / 899.1             |

Unlike macOS, the Linux WebContent RSS remained near 899 MiB more than 100 seconds after release. It is an observed high-water/retention result, not proof of a leak. This package used a measurement-only window and synthetic audio, so it does not establish memory use in the real player or normal desktop environment.

## Linux release artifact compatibility regression — 2026-09-30

The GitHub Linux artifacts from run `36720616713` at `95c9f5395927fcce27c7846204bdc64d86a65c23` were built on `ubuntu-24.04`. I downloaded its `crate-linux-0.1.0.deb` and installed it in an isolated Debian 12 amd64 container with WebKitGTK 2.50.6. Launch failed before a window appeared: `/lib/x86_64-linux-gnu/libc.so.6` did not provide `GLIBC_2.39`, which the packaged binary requires. The package metadata did not declare a matching libc minimum, so installation succeeded despite the incompatible binary.

The new `verify-linux-glibc.mjs` gate rejects the old artifact against the supported GLIBC 2.36 ceiling with `Binary requires GLIBC_2.39; maximum supported is GLIBC_2.36`. On revision `59ddb5d5c6b927dfb8ba440ea6feeafe20b669bb`, [Build Desktop Apps run 36728542909](https://github.com/thecrateapp/crate/actions/runs/36728542909) completed all three Linux, Windows, and macOS jobs successfully, including the Linux GLIBC verifier, artifact-version checks, and uploads. The Linux artifact was built on Ubuntu 22.04 amd64; its `.deb` declares `libwebkit2gtk-4.1-0 (>= 2.40.0)`.

I downloaded `crate-linux-0.1.0.deb` from that run and installed it in an isolated Debian 12 amd64 container. With GLIBC 2.36, the packaged app opened a visible `Crate` window under Xvfb within 12 seconds and remained alive until the smoke ended. The SHA-256 of the tested `.deb` is `ed30a8bc15aca33283bb7a4a78f9bca9ae909a510b66146c0b40be528e3df9af`. This verifies the launch ABI and the package's declared WebKitGTK floor in a container; it does not cover a normal desktop session, accelerated GPU, the exact WebKitGTK 2.40 floor, or installed-player behavior. Ubuntu 22.04 runner use is transitional; move Linux builds into a Debian 12 based environment before those hosted runners retire.

## macOS artwork callback ownership — C07

On macOS 27.0.1 arm64, the artwork ownership path was audited and tested against the native `MPMediaItemArtwork` API. `load_artwork` wraps the `NSImage` returned by `initWithData:` in `Retained`; `load_modern_artwork` captures an owned clone in the request-handler block. The artwork cache owns the initialized artwork object until replacement or clearing, while `setObject:forKey:` lets the Now Playing dictionary retain the artwork it displays. The ownership chain is artwork → request-handler block → image, with no reverse reference or retain cycle.

`retained_artwork_request_block_survives_artwork_replacement` creates two native artwork objects, drops the Rust image and block owners, then asks the previous artwork for an image after the newer artwork exists. Objective-C weak references confirm both source images remain alive, and the delayed request returns the original image. This directly exercises block lifetime through `MPMediaItemArtwork`; it does not exercise the installed app's `MPNowPlayingInfoCenter`, OS media controls, or rapid real-track playback. No use-after-free was reproduced.

On source commit `5c0072ee32140f262c2fb6d2cbf0a49d3a8bfbe1`, `cargo test --manifest-path app/listen-desktop/src-tauri/Cargo.toml --lib` passed 48/48 and `cargo clippy --manifest-path app/listen-desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` passed. Apple documents the request-handler initializer and callback size contract in [`MPMediaItemArtwork.initWithBoundsSize:requestHandler:`](https://developer.apple.com/documentation/mediaplayer/mpmediaitemartwork/init%28boundssize%3Arequesthandler%3A%29?language=objc). C07's object-lifetime regression is covered; the installed Now Playing smoke remains open with C03.

## macOS Now Playing playback state — C03

On the same macOS 27.0.1 arm64 host, a native MediaPlayer probe set `MPNowPlayingInfoCenter.playbackState` to playing, paused, and stopped and read back raw values 1, 2, and 3. A Rust regression test now calls `set_now_playing_playback_state` for those three states and reads the value back from the native center; it restores the test process's initial state on exit. Apple documents that macOS apps must update this property whenever playback begins or halts in [`MPNowPlayingInfoCenter.playbackState`](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter/playbackstate?language=objc).

On source commit `7bae0cbc05c91f2a744c32bd89da15e702acf414`, Rust tests passed 49/49, Clippy passed with `-D warnings`, and rustfmt check passed. This validates the app's native state setter and mapping. It does not validate remote-command delivery, competing media apps, or controls during real playback, backgrounding, headset changes, and sleep/wake; the installed-app C03 smoke remains pending.

## Google native OAuth return — F10

On the temporary macOS test bundle built from source commit `013a2c63ce1b269fd9d1ea3f6914de342a892c34` on macOS 27.0.1 arm64, Diego completed Google login and Crate reached its authenticated state. Chrome remained open on Google's “Vas a volver a iniciar sesión en lespedants.org” confirmation/return screen. The app login succeeded; the browser window is separate and is not dismissed by the Tauri deep-link handler. The screenshot's “Continuar” control is Google's own confirmation. This is a manual smoke of Google login on this macOS host only; it does not cover Apple, Windows/Linux, account linking, cancellation, or callback replay. The temporary test bundle uses identifier `app.cratemusic.crate.desktop.manual20260930` and is not a release artifact.

After that smoke, the Tauri callback was changed to pass through Listen's `/auth/callback?desktop=tauri` completion page before opening the `cratemusic://` link. That route already displays the “Volver a Crate” confirmation and a fallback button, so Chrome should show that the handoff completed instead of retaining Google's confirmation screen. Backend tests verify the HTTPS redirect and one-time code; the updated browser handoff still needs a manual run against the changed API.

Diego retested the temporary desktop app after this change: Crate authenticated, but Chrome still displayed Google's confirmation page. The app defaults to `https://api.lespedants.org`, while PR #259 is still open, so that API is not yet running the updated callback. The retest therefore confirms the existing deep-link login works but does not exercise the HTTPS completion redirect. Google authorization also set `prompt=consent` on every attempt. Crate only uses Google's user-info response and does not store a Google refresh token, so login no longer requests offline access or forces consent. Account-linking flows use `prompt=select_account` so the user can choose a different Google identity; first-time consent can still appear for that identity. Tauri cannot close a tab opened in the external browser, but after the API update the tab should leave Google's page and show Crate's completion page.

Persistent review of commit `f194f674` then found that a failed handoff restore could leave OAuth account linking in progress until its 15-minute expiry. Claims now hold a 90-second lease while the canonical handoff remains available; another request can safely reclaim it after the lease expires. Redis can also migrate legacy pending entries after the same grace period. Unit and API tests cover lease expiry, an active concurrent claim, and recovery when both completion and restoration fail. A disposable Redis 7 container also passed claim, concurrent-claim, lease-expiry recovery, restoration, completion, and migration of a legacy pending entry. Backend Tests and PR Agent Review for `acfe4baa31b3d1580723e68914a751a0b3e9a362` both passed. The desktop matrix, Android build, backend, frontend, and React Doctor workflows for `f194f674` also passed on their respective jobs.

The next persistent review reported that native OAuth, OAuth account-linking, and Last.fm handoffs allowed in-memory fallback whenever `DOMAIN` defaulted to localhost, even with no explicit environment. They now share a helper that permits this fallback only when `CRATE_ENV` is explicitly `dev`, `development`, or `test`, and removes expired/corrupt in-memory records during operations. Tests also exercise the fallback policy and expired claim leases. The review's `get_home_playlist` signature concern is a false positive: the callee accepts `session=`; the callback-test concern is also covered by `TestOAuthCallback.test_native_callback_redirects_with_code_only` and the Listen callback component tests. The reported `session_id` disclosure was checked: the value is a random internal session identifier, not an access or refresh credential, and native link start/completion still require a verified bearer token. It does not by itself authorize a session. The reported `app_id` mismatch is also ruled out: both native link startup and completion require the Tauri app id, completion passes that validated request id to the handoff claim, and tests reject other native app ids at both endpoints.

The review also flagged the one-time handoff code in the Tauri HTTPS callback query string. Tauri now receives `desktop`, `code`, and `state` in the URL fragment instead, then removes them from the address bar before opening the app. The browser does not send a fragment in the HTTP request, so it stays out of proxy query logs and referrer headers; the opaque code remains short-lived, one-time, and PKCE-bound.

The OAuth-focused backend tests (`141 passed, 12 skipped`), Listen `AuthCallback` tests (`7 passed`), and changed-file pre-commit hooks passed on the earlier working tree. The merged branch revision and its current CI results are recorded below.

### Persistent review — Google offline access

The review of `2903365a` says removing `access_type=offline` can silently stop the application receiving a Google refresh token. In the current product flow this is not a required credential: Google is used only for identity (`openid email profile`); [`_google_userinfo`](../../app/crate/api/auth.py) exchanges the code, uses the access token for Google's user-info endpoint, and returns only that profile. The callback persists the provider subject and email metadata, not provider tokens. The app's refresh token is a separate Crate session JWT. Google unlink removes the local external identity and does not call Google's token-revocation endpoint; there is no existing server-side Google grant to revoke or Google API sync that depends on a refresh token.

The existing regression tests cover both sides of this contract: `test_google_userinfo_does_not_expose_provider_refresh_token` supplies a token response containing a refresh token and verifies only user info is returned, while `test_public_google_login_uses_identity_scopes_without_offline_access` and `test_google_oauth_start_does_not_force_consent_for_existing_grants` assert the identity request does not ask for offline access or forced consent. The finding is therefore not a regression in current behavior. If a future feature calls Google APIs after login, it must add explicit scopes, secure refresh-token storage/rotation, and unlink-time revocation together; requesting offline access during identity login alone would create an unused long-lived credential.

### Persistent review — native Last.fm retryability

The review found that transient HTTP 408/429 responses and malformed or unclassified successful responses from Last.fm were marked non-retryable. In the native linking flow that could discard the browser handoff even when the provider failure was temporary. These responses now remain retryable; Last.fm error code 8 (temporary operation failure) joins the existing transient provider errors, while definitive code 15 remains non-retryable. Regression tests cover 408, 429, missing/unknown error details, and the provider classifications. `test_native_lastfm_link_api.py` also verifies a failed completion keeps the pending token available for retry. The review's test-mock concern is a false positive: the endpoint imports `lastfm_get_session_strict` inside the handler, so patching `crate.scrobble.lastfm_get_session_strict` before the request is handled patches the reference that the handler resolves.

The next review found that provider denial returned an HTTP 400 for native login instead of returning to the app. Native login denials now redirect through the validated `cratemusic://oauth/callback` with the native state and `error=cancelled`; native callback consumers clear the matching secure PKCE record and do not emit a successful-auth event. Tests cover server denial redirects and client cleanup. The review also requested a contract test for Tauri's HTTPS callback fragment: `AuthCallback.test.tsx` already verifies fragment parsing and the deep-link handoff, and new backend tests now assert the generated Tauri fragment and preserve the Android/iOS query-string contract.

The review then described the success and cancellation redirect paths as inconsistent. They take different initial routes by design: successful Tauri OAuth returns to the HTTPS `/auth/callback` fragment page so the one-time code is not sent in an HTTP query; that page strips the fragment and opens `cratemusic://oauth/callback?code=...&state=...`. A denial contains no code and goes straight to `cratemusic://oauth/callback?state=...&error=cancelled`. Tauri consumes both deep links with `consumeOAuthCallbackUrl`; tests now cover the backend success URL, the browser fragment-to-deep-link bridge, successful exchange, and cancellation cleanup. The inconsistency finding is therefore a false positive.

On source revision `0e921f66`, the final OAuth regression suite passed: backend `test_auth.py` and `test_native_oauth_link_api.py` (10 tests for the added exact Tauri fragment contract), Listen AuthCallback/native OAuth suites (37 tests), and Tauri init tests (18 tests). The Last.fm retryability suites passed 29 tests. The complete exact-head Backend Tests and Frontend Tests workflows also passed above; the branch is clean and pushed at this revision.

## Linux desktop handover and merged branch validation — 2026-09-30

The Linux agent's [desktop validation report](tauri-linux-desktop-results-2026-09-30.md) records a real GNOME Wayland run on CachyOS. R03–R05 pass for the synthetic offline workload after removing per-file path IPC. The previous R01 Linux measurement is invalidated by delayed-ACK behavior in its local HTTP fixture; rerun it with the corrected fixture above. R07 and R08 are partial; AppImage launch and MPRIS are partial; native UI automation and real-player/offline flows remain open.

The report measured visualizer RAF intervals around 23–24 ms. Diego also confirmed that it feels too slow on an i9 Wayland machine, so Tauri Linux now hides the visualizer until rendering can meet the required frame rate. The change is covered by `ExtendedPlayer.test.tsx`; web and Capacitor keep the existing visualizer.

Revision `31ecac20900a712e95e21965d3d82c5834f6c7a5` merges current `main` and includes the Linux agent's `7f79f2ed` commit. Local checks passed: Rust 50/50, Clippy with `-D warnings`, Desktop Vitest 45/45, desktop-version tests 15/15, Listen/Desktop typechecks and production builds, Listen lint, the Linux visualizer test 7/7, palette ticket-fetch test 1/1, and `docker compose config --quiet`. The merge commit hooks passed Ruff, Ruff format, Prettier, and Listen ESLint. Pytest was unavailable in the local Python installation, so backend validation ran in CI.

All manually dispatched workflows passed on that exact revision: [Build Desktop Apps](https://github.com/thecrateapp/crate/actions/runs/36769695744) (Linux, macOS, Windows), [Build Android](https://github.com/thecrateapp/crate/actions/runs/36769696429), and [Backend Tests](https://github.com/thecrateapp/crate/actions/runs/36770071955), including all eight shards and coverage. The pull-request [Frontend Tests](https://github.com/thecrateapp/crate/actions/runs/36769600208), [React Doctor](https://github.com/thecrateapp/crate/actions/runs/36769600187), and [PR Agent Review](https://github.com/thecrateapp/crate/actions/runs/36769595295) also passed. Some PR jobs were skipped because the PR remains draft; the manual runs above cover those build and backend-test gates. This closes C06 for the revision, not the installed OS/WebView, real-player, signing, or upgrade gates.

## Recommendation decisions — R01–R13

The original review numbers nine recommendations. R01–R08 follow the measurement work above; R09–R13 below are an explicit tracking extension over recommendations 6–9 and the compatibility/release section. This mapping is inferred because the source review did not assign R09–R13 IDs.

### R11 — macOS Keychain prompt investigation — 2026-10-01

The credential path in `secure_session.rs` uses the OS keyring under the stable Tauri bundle identifier and is exposed only through the three allowlisted Rust commands. Read-only inspection of `/Applications/Crate.app` found an ad-hoc signature, no Team ID, and a designated requirement tied to that binary's CDHash. The local keychain contains an Apple Development identity, but no Developer ID Application identity. Before the current change, the desktop workflow also did not import a signing certificate or configure notarization; ad-hoc tester bundles therefore could not validate Keychain trust across rebuilt or updated app binaries.

This is consistent with renewed Keychain authorization after an app rebuild: macOS Keychain ACLs trust specific applications and prompt when the caller is not trusted, while Apple's code-signing guidance says signed upgrades avoid repeated access alerts. The inspection alone cannot distinguish an app-authorization prompt from a request to unlock the `login` keychain, so it does not prove the user's exact dialog cause. See Apple's [Keychain access-control documentation](https://developer.apple.com/documentation/security/access-control-lists) and [code-signing guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Introduction/Introduction.html).

The macOS tag job now imports a Developer ID Application certificate, passes its identity plus Apple notarization credentials into Tauri, verifies the authority and stapled ticket, and rejects tag builds that lack those credentials. It keeps ad-hoc signing for PR/tester builds and no longer overwrites Tauri's signature after bundling. To enable tag releases, configure repository secrets `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`, plus the repository variable `APPLE_SIGNING_IDENTITY` with the exact `Developer ID Application: …` certificate name.

The first manual desktop run after wiring signing, `36790028684` on `7dedd484`, failed on macOS because empty `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` variables still made Tauri attempt to notarize an ad-hoc tester build (`Team ID must be at least 3 characters`). Non-tag macOS builds now unset those variables before invoking Tauri. The corrected exact-head run `36791161770` on `a587a15b` passed macOS, Linux, and Windows; both macOS architectures produced valid ad-hoc signed tester ZIPs and Tauri skipped notarization as expected. This validates the tester path, not the tag-only signing path. No Developer ID certificate or notarization credentials are available for an actual release run. Installing that signed release over the existing app and checking repeated launches and an upgrade remain open. Do not weaken the Keychain ACL or replace the OS keyring to suppress a prompt.

| ID                                       | Decision                                                                                                                                                                                                        | Remaining evidence or work                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R01 — shared HTTP transport              | Keep the shared reqwest client. The corrected loopback probe shows connection reuse and lower total time on all three hosted OS runners and the local Mac.                                                      | Measure TLS/API traffic, cancellation, CPU/RSS, and installed-app resource use before claiming production gains.                  |
| R02 — HTTP resource lifetime             | Keep the cleanup changes. Mac development and packaged soaks returned the resource table to baseline for all 150 requests.                                                                                      | Run packaged resource-table checks on Windows and Linux.                                                                          |
| R03 — offline hydration and verification | Keep cached hydration and batched verification; the synthetic Mac measurements are bounded and warm-cache hydration is below 1 ms.                                                                              | Linux synthetic evidence is in the agent report; measure Windows and real library/download workloads.                             |
| R04 — verification concurrency           | Keep the current global limit of eight. Concurrent Mac callers showed no material throughput reason to change it.                                                                                               | Confirm contention under real concurrent downloads on Windows/Linux.                                                              |
| R05 — offline index writes               | Keep the atomic JSON snapshot and same-turn batching; do not add a journal based on synthetic data alone.                                                                                                       | Measure real completion cadence and write latency on Windows/Linux before changing storage format.                                |
| R06 — media session diffs                | Resolved in the frontend/native command bridge; metadata/artwork are separated from playback state and position, with 21 focused tests passing.                                                                 | Test OS media controls during real playback and remote commands.                                                                  |
| R07 — visualizer and power               | Keep the visualizer hidden in Tauri Linux until it meets the user's smoothness requirement; web and Capacitor retain it. Mac synthetic runs are near 60 Hz.                                                     | Release/HiDPI measurements on Windows and ordinary Linux desktops; do not infer energy use from RAF alone.                        |
| R08 — decoded-audio memory               | Keep current long-track behavior pending per-OS evidence, as requested. Mac and Linux synthetic probes show different post-release retention.                                                                   | Windows RSS, real-player overlap/gapless and long-track measurements on all OSes; decide a budget/fallback from those captures.   |
| R09 — runtime capability boundaries      | Keep explicit `isTauriRuntime`/`isCapacitorRuntime` checks; do not broaden global `isNative`, which selects Capacitor plugins. Defer a capability-facade refactor until it removes demonstrated duplication.    | Revisit when a concrete cross-runtime defect or measurable maintenance cost appears.                                              |
| R10 — server/session transitions         | Keep the F05/F06 transition fixes and their regression coverage. Defer a broad transition orchestrator extraction; current evidence does not establish one safe shared ordering for every auth/offline flow.    | Add a focused design only if new transition bugs or duplicated behavior recur.                                                    |
| R11 — permissions and secrets            | Keep Tauri sessions in the OS credential vault and keep key access behind allowlisted Rust commands. Do not add a wider upload scope; no upload-plugin permission appears in the current Tauri capability list. | Verify macOS keychain prompting on the signed release identity and exercise Windows/Linux vault behavior on installed builds.     |
| R12 — observable errors                  | Keep runtime error reporting and typed secure-storage failures; optional artwork failures stay non-blocking. Avoid a blanket conversion of optional catches into user-facing errors.                            | Audit only critical auth/persistence paths as they change; check telemetry remains credential-free.                               |
| R13 — compatibility and release          | Keep the published support floors and artifact verifiers. CI now passes the current three-OS desktop build; a Debian 12 launch verified GLIBC 2.36 compatibility on an earlier artifact.                        | Install on the exact minimum OS/WebView versions; validate signed/notarized release upgrades and supported Linux desktops/codecs. |

## Acceptance tracking — C01–C07

The review documents identify C03, C06, and C07, but do not define C01, C02, C04, or C05. The following mapping is inferred for bookkeeping; it must not be read as an original acceptance checklist.

| ID  | Inferred gate                             | Current status                                                                                                                                                                                                                        |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | Support-floor metadata and declarations   | Partial: exact-head macOS ARM64 and Intel artifacts declare macOS 11.0; Linux packages declare WebKitGTK 2.40+; exact minimum hosts remain untested.                                                                                  |
| C02 | Launch/window lifecycle and package smoke | Partial: macOS 27 release bundle opened, hid, and reopened; Linux Debian 12 container launch passed. Windows installed launch and upgrade remain open.                                                                                |
| C03 | macOS Now Playing state                   | Native state mapping/test passes; installed controls and real playback remain open.                                                                                                                                                   |
| C04 | Native OAuth handoff                      | 87 focused backend tests pass on the current branch, and Google login succeeded on macOS; the updated deployed callback and Apple/Windows/Linux account flows remain unverified.                                                      |
| C05 | Linux package ABI/WebKit compatibility    | Partial: Debian 12 with GLIBC 2.36 and WebKitGTK 2.50.6 launched; exact WebKitGTK 2.40 floor and normal desktop install remain open.                                                                                                  |
| C06 | Desktop CI builds and artifact checks     | Pass for application source revision `a587a15b` on macOS ARM64/Intel, Windows, and Linux in workflow 36791161770; current head `63908623` is documentation-only relative to that source. Linux GLIBC_2.34 and artifact checks passed. |
| C07 | macOS artwork callback ownership          | Native lifetime regression test passes; installed Now Playing artwork remains open.                                                                                                                                                   |

## Other native gates still pending

The installed release matrix remains open for macOS 11 and Intel, Windows 10 1803/WebView2, and Linux/WebKitGTK 2.40. Windows still needs process RSS captures and installed-app smoke. Linux now has a real GNOME Wayland launch and MPRIS smoke, but still needs route and installed-player inspection, offline flows, X11, WebKitGTK 2.40, and upgrade from the previous package. Provider credentials, media-system behavior, signed artifacts, and the remaining native acceptance scenarios are not covered by this report. A green CI build does not substitute for those runs.

## Finding implementation crosswalk — F01–F20

The fixes below are present in the current branch and their regression suites are part of the green Listen frontend, Rust, backend, or desktop-version checks recorded above. This closes the code findings; it does not turn the separately listed installed-platform acceptance checks into passes.

| Finding | Current fix and regression evidence                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | Offline cold-start identity is restricted to a previously verified user with cached media; `AuthContext.test.tsx` covers that mode and logout/anonymous boundaries.                                                                                 |
| F02     | Tauri `connect-src` admits both offline asset URL forms used by WebAudio; the exact policy was exercised in the recorded Chromium CSP probe.                                                                                                        |
| F03     | `tauri-filesystem.ts` normalizes Windows file/path-not-found errors to a stable code; `tauri-filesystem.test.ts` covers Win32 error 2 and 3.                                                                                                        |
| F04     | The vendored HTTP plugin is built without cookie-store support, and startup removes legacy `.cookies`; a Rust test covers idempotent cleanup.                                                                                                       |
| F05     | Removing an active server revokes its captured session before changing selection; `ServersSection.test.tsx` covers removal and fallback behavior.                                                                                                   |
| F06     | Auth/runtime identity resets before switching to a tokenless server; `AuthContext.test.tsx` covers stale responses and tokenless switching.                                                                                                         |
| F07     | Playback-recovery intent is invalidated by later pause/stop actions; gapless recovery and player-control tests cover the races.                                                                                                                     |
| F08     | The visualizer owner destroys its renderer on unmount; `useMusicVisualizer.test.ts` covers lifecycle cleanup. Tauri Linux remains hidden under the user's frame-rate requirement.                                                                   |
| F09     | Tauri external links go through the explicit opener bridge; `external-links.test.ts` ensures opener failures never navigate the app window.                                                                                                         |
| F10     | Native OAuth linking is bound to the initiating user, server, and app; backend native-link API tests and Listen OAuth tests cover the handoff.                                                                                                      |
| F11     | Last.fm uses an external browser and a session-bound native callback; `native-lastfm-oauth.test.ts` covers success, retry, cancellation, and stale-flow rejection.                                                                                  |
| F12     | Playlist and Jam invitations use public share URLs; `share-url.test.ts`, playlist tests, and `JamSession.test.tsx` cover native/public origins.                                                                                                     |
| F13     | Tauri downloads use temporary files, atomic promotion, failure cleanup, and orphan reconciliation; offline transfer and Rust storage tests cover partial files and interrupted promotion.                                                           |
| F14     | Tauri transfer cancellation closes stalled requests and has idle/total deadlines; frontend transfer tests and Rust stalled-response tests cover cancellation and cleanup.                                                                           |
| F15     | Offline validity includes delivered size and source fingerprint/version; `offline-native-assets.test.ts` covers changed-source replacement and preserving the old copy on failed promotion.                                                         |
| F16     | Normal/single-instance activation restores and focuses the main window; Rust activation tests distinguish normal launch, deep links, and background media commands.                                                                                 |
| F17     | Linux theme reads are asynchronous, cached, coalesced, and time-bounded; `linux_desktop_theme.rs` covers deadlines and stalled portal futures.                                                                                                      |
| F18     | Windows SMTC resolves validated cached artwork with `StorageFile`/`CreateFromFile`; Windows media-control tests cover managed paths and stale thumbnail requests.                                                                                   |
| F19     | Linux MPRIS artwork now uses the bounded native cache; Rust cache tests cover byte/entry limits, active-item protection, and evictions.                                                                                                             |
| F20     | Release versions are resolved before packaging and inspected in platform artifact metadata; `desktop-version.node-test.mjs` covers version propagation and artifact verification, and the three-OS workflow passed on the code-equivalent revision. |

## Follow-up validation — 2026-10-01

The validation snapshot was updated against branch revision `63908623f27e8944d24ec1efb045ae419791d14b`, tracking `origin/feat/tauri-desktop-app`. Changes since application source revision `a587a15b` are documentation-only, so the three-OS build result below still covers the current source code.

- OAuth review follow-up: ran from the repository root in the prebuilt `musicdock-worker-test:local` image:

  ```sh
  docker run --rm --entrypoint python \
    -v "$PWD":/workspace -w /workspace \
    -e PYTHONPATH=/workspace/app musicdock-worker-test:local \
    -m pytest app/tests/test_auth.py -k 'oauth or google' \
    app/tests/test_native_oauth_exchange.py \
    app/tests/test_native_oauth_link.py \
    app/tests/test_native_oauth_link_api.py -q
  ```

  It passed **87 tests**, with 49 deselected. Google OAuth exchanges use Google's access token only for `userinfo`; provider refresh tokens are discarded, no provider token is persisted, and unlink does not call Google's revocation API. Crate session refresh JWTs are independent. The finding about loss of a Google refresh token does not describe a current app dependency; do not request offline access until a Google API/revocation use case exists.

- Current PR checks on `63908623`: Frontend Tests (Listen tests/build and desktop typecheck/tests), appearance, React Doctor, changed-Python security scan, PR Agent Review, and the Backend Tests workflow passed. PR #259 remains a draft, so Backend quality/test shards/coverage, Android and simulator builds, and the desktop pull-request build were skipped. The broader OAuth subset was run locally in the existing test image.
- Targeted OAuth review regressions were rerun against the unchanged application source at `700803d7`: three Google backend contract tests passed, `AuthCallback.test.tsx` passed 7/7, and `tauri-init.test.ts` passed 18/18. Together these cover Google identity scopes/provider-token handling, the Tauri HTTPS-fragment success handoff, callback conversion to the app deep link, and Tauri deep-link consumption. The persistent review still displays its two earlier OAuth observations; no new code review comments were added for this revision.
- The manually dispatched Build Desktop Apps workflow `36791161770` passed macOS, Linux, and Windows on the code-equivalent revision `a587a15b`; both macOS tester architectures passed signature verification. This does not test Developer ID notarization or installed upgrades. The frontend, React Doctor, appearance, security, and PR Agent Review checks on `63908623` also passed; its desktop, Android, and simulator PR jobs were skipped because the PR is still a draft.
- C04 remains partial: automated OAuth callback/exchange/link coverage and the earlier macOS login are verified; the updated deployed callback and installed OAuth flows on all three desktop operating systems are still open.
- The macOS host is macOS 27.0.1 on Apple M5, not a support-floor or Intel host. A manual test app is currently running and was left untouched. Minimum-version acceptance, Windows installed checks, real-player RSS, signed release installation, and the remaining Linux/WebKitGTK/X11/upgrade scenarios remain open as described above.
