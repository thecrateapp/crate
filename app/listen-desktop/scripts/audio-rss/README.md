# Native Tauri audio memory probe

This probe decodes local audio fixtures with WebAudio inside the Tauri WebView, retains the resulting `AudioBuffer`s for 90 seconds, then releases them. It reports the WebView sample rate and decoded PCM byte counts to a loopback fixture server. It makes no Crate API calls and needs no account.

## Run the probe

Start the fixture server with named local files:

```bash
python3 app/listen-desktop/scripts/audio-rss/fixture_server.py \
  --track track20=/absolute/path/to/long-track.flac \
  --track track16=/absolute/path/to/another-track.flac
```

From the repository root, start a Tauri development window with the probe page:

```bash
npm run --workspace=app/listen-desktop tauri:dev -- \
  --config scripts/audio-rss/tauri.config.json
```

The page loads both named fixtures by default. Use `?tracks=name1,name2` to choose a different pair and `&releaseAfterMs=90000` to change the hold time. The page displays each event and the server appends it to `audio-rss-events.jsonl` in its working directory. It records `AudioContext.sampleRate`; calculate memory from the returned `AudioBuffer` lengths and sample rate, not the encoded FLAC sizes.

Run each memory capture on a fresh app process. Record the commit, OS version, architecture, RAM, power mode, fixture names/durations, `AudioContext.sampleRate`, decoded bytes, process RSS before decode, peak, steady hold, and after release. Repeat at least three times before comparing changes. Test a single long fixture and two long fixtures; a 60–120 minute fixture is useful when available.

## Capture native memory

Include the Tauri process and its WebView renderer. Keep the renderer’s RSS separate from any broader process-group sum.

On macOS, list the current Tauri and WebKit processes, then sample the Tauri PID and the matching WebContent PID with Apple’s footprint tool:

```bash
ps -axo pid=,ppid=,rss=,etime=,comm= | rg 'crate-desktop|com.apple.WebKit'
footprint --pid TAURI_PID --pid WEB_CONTENT_PID --pid WEBKIT_GPU_PID \
  --pid WEBKIT_NETWORK_PID --sample 0.5 --sample-duration 125 \
  --json audio-rss-footprint.json --noCategories
```

`ps` reports RSS. `footprint` also reports the process physical footprint and swapped pages; report these separately because they are not RSS.

On Linux, sample the Tauri and WebKit processes every 250 ms:

```bash
while true; do
  date -Is
  ps -C crate-desktop -C WebKitWebProcess -C WebKitNetworkProcess \
    -o pid,ppid,rss,etimes,comm
  sleep 0.25
done
```

On Windows, use Task Manager’s Details tab and add **Memory (active private working set)** and **Commit size** columns. Capture `crate-desktop.exe` and its `msedgewebview2.exe` child processes through decode, hold, and release. Record the process IDs and avoid including WebView2 processes owned by other applications.

These instructions capture development WebViews. Acceptance for an OS still requires repeating the probe in that OS and recording the installed release package separately.
