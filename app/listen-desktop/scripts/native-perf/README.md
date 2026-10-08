# Native Tauri performance probe

This isolated Tauri window benchmarks the existing offline index and asset
verification paths against local app data. It also exercises the Rust HTTP
client pool against a local HTTP fixture. It makes no Crate API calls and does
not use the user's installed application data.

## Run the offline filesystem probes

Start the existing loopback event receiver with a disposable fixture:

```bash
python3 -c 'from pathlib import Path; Path("/tmp/tauri-native-perf-empty").write_bytes(b"x")'
python3 app/listen-desktop/scripts/audio-rss/fixture_server.py \
  --track placeholder=/tmp/tauri-native-perf-empty \
  --port 18766 \
  --report-file=/tmp/tauri-native-perf-results.jsonl
```

From the repository root, launch the measurement-only window:

```bash
CRATE_NATIVE_PERF_TELEMETRY=1 npm run --workspace=app/listen-desktop tauri:dev -- \
  --config scripts/native-perf/tauri.config.json
```

In PowerShell, set `$env:CRATE_NATIVE_PERF_TELEMETRY = "1"` before running the
same npm command.

The probe seeds only its isolated `app.cratemusic.crate.desktop.native-perf-bench20260930` app-local directory, measures metadata hydration, checks 100/1,000/5,000 files through `verifyNativeOfflineAssets`, compares sequential and concurrent verification callers, and records durable index write counts/bytes for serial and coalesced mutations. It posts hydration phase progress events and a final results event to the JSONL path above. It removes its `offline-media` and `offline-meta` directories when finished.

Set `CRATE_NATIVE_PERF_TELEMETRY=1` when running the probe locally. This
enables a measurement-only Vite shim around `@tauri-apps/plugin-fs` that counts
successful writes to the offline asset index's `.next` file and records the
UTF-8 payload size plus duration. The shim is disabled for normal app builds
and does not modify Tauri's read-only IPC bridge. The Windows workflow enables
it only for the capture subprocess.

To collect the same synthetic R03–R05 workload on a Windows WebView2 runner,
dispatch `Build Desktop Apps` with `measure_windows_offline_perf=true`. The
optional Windows-only step launches this probe with a unique app identifier,
checks all expected hydration, verification, and durable-write counts, and
uploads raw JSON plus logs as `desktop-native-offline-performance-windows-*`.
It does not run in pull-request or push builds and does not contact the Crate
API. The Windows capture is still a synthetic runner result; it does not
replace a real library or download-cadence measurement.

For index writes it also compares a single same-turn burst with 1,000 mutations arriving in pairs, matching the offline download scheduler's current concurrency of two. The burst is a stress ceiling; it does not represent the ordinary completion cadence of real network downloads.

## Run the HTTP client pool probe

From `app/listen-desktop/src-tauri`, run once in a fresh process:

```bash
cargo run --release --example http_pool_bench
```

The example compares a fresh reqwest client per request with a shared client
against a loopback HTTP/1.1 server. It reports cold request time, total time,
p50/p95, accepted connections, and peak open sockets for 100/1,000/5,000
requests at concurrency 1 and 8. These numbers isolate connection reuse; they
do not substitute for a real API/TLS/proxy benchmark or CPU/RSS profiling.

To compare the same Tauri HTTP client against Crate's API over HTTPS, set
`CRATE_R01_API_URL` to a read-only endpoint. The public setup-status route
performs a database count but no writes:

```bash
CRATE_R01_API_URL=https://api.lespedants.org/api/setup/status \
  cargo run --locked --release --manifest-path app/listen-desktop/src-tauri/Cargo.toml \
  --example http_pool_bench
```

This sends 25 measured requests plus one warmup for each client mode at
concurrency 1 and 8. The remote run reports latency only because the server does
not expose per-client accepted-connection counts. Keep production traffic low;
this sample is diagnostic, not an SLA or a load test.

To collect the same sample from GitHub's Linux, Windows, and macOS runners, run
the `Build Desktop Apps` workflow manually with `measure_r01_api=true`. The
opt-in step runs only for that manual dispatch; pull-request and push builds
continue to use the local fixture only. It sends 104 read-only requests per OS
runner; the workflow does not add a preflight request.

## Run the visualizer frame probe

Start the loopback event receiver, then launch the isolated visualizer window:

```bash
python3 app/listen-desktop/scripts/audio-rss/fixture_server.py \
  --track placeholder=/tmp/tauri-native-perf-empty \
  --port 18766 \
  --report-file=/tmp/tauri-visualizer-results.jsonl

npm run --workspace=app/listen-desktop tauri:dev -- \
  --config scripts/native-perf/visualizer.config.json
```

The page starts automatically. It constructs the production `MusicVisualizer`
with a deterministic synthetic analyser, records renderer tick duration and
frame intervals for three visible runs, and posts the results to the fixture
server. The 720 × 720 CSS-pixel canvas matches the square player visualizer.
It also records the canvas render size, device pixel ratio, WebGL renderer, and
context attributes. **Stop renderer** checks explicit RAF
cancellation. To test minimize/restore and HiDPI changes, minimize/restore the
native window or change display scaling while it runs; record whether
`visibilityState` changed and the before/after render sizes.

The page instantiates `MusicVisualizer` directly; it does not mount the React
`useMusicVisualizer` hook or exercise real audio. The hook's visibility
lifecycle is covered by its automated tests. Native minimize/restore here
checks WebView visibility and RAF suspension/resumption; verify hook integration
separately in the installed player.

This probe runs through Tauri's development WebView. Its WebGL workload is the
same renderer code but the JavaScript is served by Vite, so use the results for
within-host comparisons only. For process CPU/RSS, sample the isolated
`crate-desktop` process and its WebKit child in Activity Monitor or with `ps`;
do not attribute whole-machine GPU or energy to the canvas without a per-process
measurement. The JSONL report gives frame p50/p95/max and synchronous tick
p50/p95/max, not GPU completion time. Repeat on release packages, macOS Intel,
Windows, and a regular Linux desktop before changing quality or battery policy.
