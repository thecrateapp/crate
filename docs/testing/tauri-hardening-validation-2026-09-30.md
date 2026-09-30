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

On `df72643d229ad7b47908f183690f5a35294a8ddf`, Desktop Vitest passed 43/43; Listen passed 2,416 tests across 323 files with 4 existing skips; Rust macOS passed 48/48 and Clippy completed with `-D warnings`. Desktop and Listen typechecks, Listen ESLint, and both Vite production builds passed. The builds retain the existing 564.65 kB chunk warning; Node also prints its `module.register()` deprecation warning.

Follow-up validation on branch revision `5d6ca6e2cd462cc469a9b81d95fbe2ec5f52687e` passed Desktop Vitest 43/43, Listen 2,416 passed with 4 existing skips, Rust 48/48, Clippy `-D warnings`, and Listen/Desktop typechecks. GitHub `Build Desktop Apps` passed all three jobs: Linux and Windows bundle/version checks, plus the macOS tester-bundle build. `Build Android` passed its typecheck, lint, contract tests, and Android tests. The signed APK/AAB steps were skipped because this was a manual non-release run. `PR Agent Review` completed successfully. These workflows are linked to the exact revision above; the PR remains draft.

## macOS native performance measurements — R01, R03–R05

All runs used this revision on the Mac17,2 ARM64 host above. The offline probes ran in an isolated Tauri development window with synthetic metadata and 1-byte files under a dedicated app identifier; the release HTTP microbenchmark used only a loopback HTTP/1.1 fixture. Timings are not production API or installed-player acceptance results.

### R01 — HTTP client reuse

`cargo run --release --example http_pool_bench` compared a fresh reqwest client per request with one shared client. Each response contained 16 KiB. This was one run; the shared client's connection count excludes the warmup request because the benchmark resets its counter after warmup.

| Concurrency | Requests | Fresh client: total / p50 / p95 | Shared client: total / p50 / p95 | Accepted connections: fresh / shared |
| ----------- | -------: | ------------------------------: | -------------------------------: | -----------------------------------: |
| 1           |      100 |            30 ms / 172 / 249 µs |                7 ms / 73 / 86 µs |                              100 / 0 |
| 1           |    1,000 |             141 ms / 75 / 88 µs |               29 ms / 24 / 31 µs |                            1,000 / 0 |
| 1           |    5,000 |             704 ms / 75 / 83 µs |              147 ms / 24 / 30 µs |                            5,000 / 0 |
| 8           |      100 |            11 ms / 218 / 255 µs |               1 ms / 96 / 174 µs |                              100 / 7 |
| 8           |    1,000 |           107 ms / 205 / 235 µs |              15 ms / 99 / 108 µs |                            1,000 / 7 |
| 8           |    5,000 |           648 ms / 312 / 393 µs |             91 ms / 102 / 167 µs |                            5,000 / 7 |

The local fixture shows that pooling reuses keep-alive connections and lowers loopback latency in this run. It does not measure TLS, proxy behavior, Crate API routes, CPU/RSS, or cancellation; those R01 acceptance checks remain open.

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

This closes the live development-WebView soak on macOS. The packaged-app soak and runtime checks on Windows and Linux remain open.

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

The new `verify-linux-glibc.mjs` gate rejects this artifact against the supported GLIBC 2.36 ceiling with `Binary requires GLIBC_2.39; maximum supported is GLIBC_2.36`. The Linux build runner is pinned to Ubuntu 22.04, whose WebKitGTK 4.1 package is newer than the declared 2.40 minimum. CI must complete the package build and glibc check on the updated branch before this regression is considered closed. Ubuntu 22.04 runner use is transitional; move Linux builds into a Debian 12 based environment before those hosted runners retire.

## Other native gates still pending

The installed release matrix remains open for macOS 11 and Intel, Windows 10 1803/WebView2, and Linux/WebKitGTK 2.40. Windows still needs process RSS captures and installed-app smoke. Linux has development and release WebKitGTK datapoints inside Debian/OrbStack under Xvfb, but still needs a normal desktop session and installed-app acceptance. Provider credentials, media-system behavior, upgrade from N−1, signed artifacts, and the remaining native acceptance scenarios are not covered by this report. A green local build or cross-compile does not substitute for those runs.
