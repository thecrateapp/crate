# Crate Desktop (Tauri 2) — app/listen-desktop

Scope: the desktop shell around the Listen app. The UI is `app/listen/src`; this
package only adds the Tauri runtime, native Rust commands, Capacitor stubs and
packaging. Platform-wide rules live in the root `AGENTS.md`.

## Layout

- `src/main.tsx` — desktop entry. Imports Listen's `App` via the `@` alias
  (`vite.config.ts` maps `@` to `../listen/src`, `publicDir` to `../listen/public`).
- `src/lib/stubs/` — `@capacitor/*` replacements aliased in `vite.config.ts`.
- `src/lib/tauri-init.ts`, `tauri-filesystem.ts`, `linux-*` — desktop-only runtime glue.
- `src-tauri/src/` — Rust shell. `lib.rs` registers all commands
  (`generate_handler!`); `secure_session.rs` (OS keyring), `offline_storage.rs`,
  `{macos,linux,windows}_media_controls.rs`, `desktop_window_bounds.rs`,
  `desktop_control.rs` (local control channel), `linux_desktop_profile.rs`
  (compositor/tiling detection, Wayland app_id), `linux_sleep_inhibitor.rs`.
- `src-tauri/tauri.conf.json` — base config; `tauri.linux.conf.json` — Linux overlay
  (frameless, transparent, 1280x820 minimum).
- `src-tauri/capabilities/default.json` — permission allowlist (fs scope, http URLs).
- `src-tauri/vendor/{wry,tauri-plugin-http}` and `vendor/plugin-http-js` —
  patched upstream crates, wired through `[patch.crates-io]` in `Cargo.toml` and
  `file:vendor/plugin-http-js` in `package.json`.
- `scripts/tauri-cli.mjs` + `scripts/desktop-version.mjs` — version resolution.
- `SMOKE.md` — manual release checklist.

## Commands

```bash
npm run --workspace=app/listen-desktop dev          # Vite only, 127.0.0.1:5178 (strict port)
make tauri-dev                                      # full Tauri dev shell
npm run --workspace=app/listen-desktop typecheck
npm run --workspace=app/listen-desktop test         # vitest
npm run --workspace=app/listen-desktop test:version # node --test, version resolver
npm run --workspace=app/listen-desktop test:glibc   # node --test, Linux glibc verifier
cargo test --locked --manifest-path app/listen-desktop/src-tauri/Cargo.toml
make tauri-build            # local .app (tauri:build = --bundles app)
make tauri-build-macos-testers   # ARM + Intel ad-hoc .app ZIPs, macOS only
make tauri-collect-artifacts
```

`make dev-test-rust` also runs the desktop cargo tests. CI:
`.github/workflows/build-desktop.yml` (cargo test --locked, version/glibc tests,
3-OS bundles, artifact version check, WebKitGTK 2.40 symbol check, Windows install
smoke, Sentry debug symbols of the shipped binary only, never blocking the release),
`test-frontend.yml` (typecheck + vitest) and `test-native-tools.yml`
(`cargo fmt --check` with Rust 1.88). Clippy is not gated in CI because the vendored
Wry warns; validation docs record `cargo clippy --locked --all-targets ... -D warnings`
as the local bar for first-party code.

The shared Crate V3 identity is fixed. Linux host preferences affect GNOME window-button
placement only (`linux_desktop_theme_snapshot`); do not reintroduce GTK palette/font overrides.

## Hard rules

- Always go through `scripts/tauri-cli.mjs` (npm `tauri*` scripts or `make tauri-*`).
  It resolves the version from `CRATE_DESKTOP_VERSION`/`TAURI_RELEASE_VERSION`, then
  the Git tag in CI, then `git describe --tags --dirty --match v[0-9]*` locally, and
  injects it with `--config`. Calling `@tauri-apps/cli` directly ships `0.1.0`.
- Keep `package.json`, `tauri.conf.json` and `Cargo.toml` `[package]` versions equal;
  `readDesktopVersionSources` fails the build when they differ.
- Windows MSI cannot encode prerelease/build metadata or components >255/255/65535.
  The wrapper throws; CI falls back to `tauri:build:windows:nsis`.
- macOS builds are ad-hoc signed everywhere, tags included (commit `b84bd3a9`). Do not
  re-add Developer ID import or notarization. `make tauri-build-macos-testers`
  asserts `Signature=adhoc` when `APPLE_SIGNING_IDENTITY` is `-`. Do not set empty
  `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`: Tauri then tries to notarize.
- Keep `"backgroundThrottling": "disabled"` on the main window in `tauri.conf.json`.
  Without it WKWebView suspends WebContent after ~4 min hidden+paused and audio comes
  back silent (commit `ccb7f860`). WebKitGTK/WebView2 ignore it.
- Credentials only through the three `secure_session_*` commands (OS keyring). Keys
  must be `crate.session.*` or `crate.oauth.*`, values <= 64 KiB; dev builds use the
  `<identifier>.dev` service. Do not weaken the keyring ACL or swap the keyring to
  silence the macOS prompt after updates (accepted risk R11 in
  `docs/testing/tauri-hardening-validation-2026-09-30.md`).
- Do not change the bundle `identifier` (`app.cratemusic.crate.desktop`): keyring
  entries, window state and app data are keyed on it.
- New native commands need: a function in `src-tauri/src`, registration in `lib.rs`,
  any new capability in `capabilities/default.json`, and a Rust test.
- Listen code that branches on desktop must use `isTauriRuntime` from
  `app/listen/src/lib/platform.ts`; desktop-only React stays in this package.

## Linux desktop integration

- **Profile.** `linux_desktop_profile::current()` decides once per launch:
  compositor (`HYPRLAND_INSTANCE_SIGNATURE`, `NIRI_SOCKET`, `SWAYSOCK`, `I3SOCK`, then
  `XDG_CURRENT_DESKTOP`) and `tiling`. The `linux_desktop_profile` command hands it to
  the frontend (`src/lib/linux-desktop-profile.ts`). There is no Ryoku flag: nothing
  read it, and Ryoku integrations (bar plugin, launcher) talk to the control socket.
- **Tiling compositors** (Hyprland, niri, Sway, i3, river) own window geometry. There
  the bounds clamp only lowers the minimum to `TILING_MIN_*` (600x480) and never calls
  `set_size`/`set_position`, and `main.tsx` drops the custom titlebar
  (`data-crate-linux-wm="tiling"` zeroes the chrome height and corner radius).
  GNOME/KDE keep the titlebar and the clamp.
- **App id.** `run()` sets the GLib program name to the bundle identifier before GTK
  starts, because GTK 3 takes the Wayland app_id from it. The window then reports
  `app.cratemusic.crate.desktop`, which matches the desktop entries' `StartupWMClass`
  (it used to report `crate-desktop`).
- **Desktop entry and icon names.** The window's app_id is always
  `app.cratemusic.crate.desktop`. The entry and icon Crate names itself by (notification
  `desktop-entry` hint and icon, MPRIS `DesktopEntry`, launcher icon, `PULSE_PROP`'s
  `application.icon_name`) come from `linux_desktop_integration::identity()`, decided
  once per launch:
  - A visible entry for Crate is installed (a `[Desktop Entry]` with `Type=Application`,
    not `Hidden`/`NoDisplay`, `StartupWMClass=app.cratemusic.crate.desktop` and an `Exec`
    running `crate-desktop`, this executable or the AppImage; searched in
    `$XDG_DATA_HOME`, then `$XDG_DATA_DIRS`, with id shadowing): Crate goes by that
    entry's id and `Icon` (the packages' `Crate` / `crate-desktop`), writes nothing, and
    removes the hidden entry and icons an earlier version wrote (only files byte-identical
    to what it writes), so docks show one Crate.
  - None (AppImage, source runs): `ensure_registered` writes
    `$XDG_DATA_HOME/applications/app.cratemusic.crate.desktop.desktop` (`NoDisplay`) and
    `$XDG_DATA_HOME/icons/hicolor/<n>x<n>/apps/app.cratemusic.crate.desktop.png` at every
    start, and Crate goes by `LINUX_DESKTOP_ENTRY`/`LINUX_ICON_NAME` (the app id).
  Tauri's bundler names the packaged entry after `productName` (`Crate.desktop`,
  `Icon=crate-desktop`, icons named after the binary) and cannot rename it.
- **Control socket** (`desktop_control.rs`): `$XDG_RUNTIME_DIR/crate/control.sock`
  (dir 0700, socket 0600), JSON lines, protocol 1. Server sends `hello` (with
  `commands`, every `cmd` accepted; `COMMANDS` in Rust, kept in step by a test), then
  `state` on every change, and `ack`/`error` per command. Commands: `play`, `pause`,
  `play_pause`, `next`, `previous`, `show` (optional `item`: raise and open that ref's
  artist/album page, a track's album with `?track=`; `DesktopControlNavigator` in
  `src/components` navigates), `seek`, `set_volume`, `set_shuffle`,
  `set_repeat`, `eq_enabled`, `eq_mode` (`smart|genre|adaptive|manual`), `eq_preset`,
  `eq_gains`, `search` (acked with a `request` id, answered later with a `result`
  line to that client only, through `desktop_control_reply`), `play_item` (a
  search result's `ref`) and `queue_item` (append a ref to the queue; acked or refused
  only after Listen answers `desktop_control_done`, 2.5 s timeout). Result items carry
  `kind`, `title`, `subtitle`, `ref`, `duration` (tracks, whole seconds) and `art`.
  Refs never carry media URLs: Crate signs those with a
  `media_ticket` (`lib/desktop-control-search.ts` strips them).
  Each client has a bounded outbox (64 lines) and one writer thread, the only writer of
  its socket, one whole line per write: lines never interleave, a `search` ack is
  queued before Listen hears of the search (so its `result` cannot overtake it), and
  `publish_state`/`desktop_control_reply` never block the main thread. A client whose
  outbox fills or whose write stalls 2 s is dropped with its open searches. At most 16
  clients at once (`MAX_CLIENTS`): one more gets only
  `{"type":"error","error":"too many clients"}` and is closed. A search Listen does
  not answer within 15 s (`REQUEST_TTL`) is forgotten, swept on every state and search.
- **Launcher art** (`desktop_launcher_art.rs`, `app/listen/src/lib/desktop-launcher-art.ts`):
  `art` is an absolute path in `$XDG_CACHE_HOME/crate/launcher-art/` (else
  `~/.cache/...`, dir 0700), named `<first 32 hex of sha256("crate-launcher-art/v1/<key>/256")>-256.<jpg|png|webp>`,
  where the key is `album:<server>:<id>` or `artist:<server>:<id>` (ids only, never
  URLs; `<server>` is `launcherArtScope()`, 16 hex of FNV-1a 64 over the normalized
  server URL, so two servers' album 11 never share a cover; Rust refuses unscoped keys,
  and Listen skips fetching another server's key after a switch). Listen tags
  items with `art_key`; `desktop_control_reply` swaps it for `art` when cached and
  returns `missingArt`; Listen fetches those with its session, crops 256 px JPEG
  squares and sends bytes to `store_launcher_art` (temp file + rename, mtime LRU,
  100 MB cap pruned at most every 5 min). A miss sends no `art`; the reply never waits.
  A search's misses share one batched ticket request and load 4 at a time; an image the
  webview already loaded at >= 256 px (resource timing) is reused with `force-cache`.
  Prewarm (`use-launcher-art-prewarm.ts`, `desktop-launcher-prewarm.ts`): at startup the
  top artists, last 500 plays (cap 200 albums + 100 artists) and follows; each new
  track; the queue (100 tracks, 3 s debounce). `launcher_art_missing` (null off Linux)
  filters what is cached; background fetches are low priority, idle-time, 2 in total. Transport goes through `handle_playback_menu_event` (same path as the
  tray and `--crate-command`); the rest is the `crate:control-command` event, which
  `tauri-init.ts` validates again and hands to Listen
  (`app/listen/src/lib/desktop-control.ts`, `use-desktop-control-bridge.ts`). Listen
  publishes the state with `update_desktop_control_state`. Keep `ControlCommand` and
  `DesktopControlCommand` in step. Consumers: the Ryoku bar's Crate plugin, scripts.
- **MPRIS** now seeks (`Seek`, `SetPosition`, `CanSeek` when a track has a length) and
  reports/sets `Volume`, `Shuffle` and `LoopStatus` from the control state.
- **Idle.** `linux_sleep_inhibitor` holds a logind `idle`/`block` inhibitor only while
  playing: logind's `IdleAction` and hypridle's idle listeners (it honours logind idle
  inhibitors by default, and holds dim, lock and blank too) wait. Never `sleep`: that
  also refuses a manual suspend (Ryoku power menu, `systemctl suspend`); manual suspend
  and the lid still suspend.
- **WebKit priority** (`linux_webkit_priority.rs`): WebKitGTK's JavaScriptCore asks RTKit
  for nice -15 on the web process's main, `EventDispatcher` and `Core: Scrolling` threads,
  which then starve the shell and compositor. A thread renices the app's own
  `WebKitWebProces`/`WebKitNetworkPr` descendants back to 0 (3 s after setup, then every
  10 s): only `SCHED_OTHER` threads below nice 0; realtime and nice >= 0 threads are left
  alone. Failures are logged in debug builds only.
- **Track notifications** (`linux_track_notifications.rs`): one transient card per new
  track, only while playing and with the window unfocused; it replaces the previous
  card (`replaces_id`), carries the cached cover (`image-path`), `desktop-entry`, and
  the actions "Show Crate" (default) and "Next" (handled from `ActionInvoked`). Cards
  go through one worker thread (the only `Notify` caller), so each replaces the id the
  previous one returned; a burst queued meanwhile shows only its newest card.
- **MCP** (`desktop_mcp.rs`): `crate-desktop --mcp` is an MCP server on stdio (JSON-RPC,
  tools: now_playing, play_pause, next_track, previous_track, seek, set_shuffle,
  set_repeat, set_equalizer, show_crate). It is a client of the control socket plus
  MPRIS, never starts the app, and returns before the single-instance plugin runs.
  Register with e.g. `claude mcp add crate -- crate-desktop --mcp`. Tools also include
  `search_library` and `play_result`.
- **Launcher** (`crate-desktop --launcher`): a rofi-script provider (Ryoku's launcher
  Script provider, or rofi): pass 1 prints search rows with the ref as `info`, pass 2
  (`ROFI_RETV=1`) plays the pick; a row's icon is the item's `art` when present. Also
  returns before the single-instance plugin.
- **Arch package:** `packaging/aur/crate-desktop-bin/` (PKGBUILD + .SRCINFO from the
  release `.deb`; bump the sha256 from the GitHub asset digest, not crate-checksums.txt).
- **Volume caveat:** Listen's player volume is the webview's own gain, not the system
  volume, so desktop widgets do not offer it (the Ryoku bar plugin dropped its slider).

## Vendored crates

- `vendor/wry`: resolves WebKitGTK 2.42 cookie symbols dynamically so the binary still
  loads on the 2.40 floor (`deb`/`rpm` depend on `>= 2.40.0`; CI checks symbols and
  glibc 2.36).
- `vendor/tauri-plugin-http`: request-resource cleanup/cancellation fixes and no
  cookie store. Its JS half is `vendor/plugin-http-js`.
- Edit vendored code only for these fixes; keep `Cargo.toml.orig` for diffing, and
  revert formatter noise in vendored permission files.

## Pitfalls

- `tauri.linux.conf.json` replaces the whole `windows` array (JSON merge patch), so
  any key added to the base window (e.g. `backgroundThrottling`) must be copied there
  if it matters on Linux.
- CSP in `tauri.conf.json` and the `http:default` URL allowlist must both change when
  adding a new origin/scheme; asset protocol scope is `$APPLOCALDATA/offline-media/**`.
- A Listen change can break desktop: `build-desktop.yml` triggers on `app/listen/**`
  and `app/shared/**`. Run desktop typecheck/test after touching Listen platform code.
- New `@capacitor/*` imports in Listen need a stub in `src/lib/stubs/` plus an alias.
- Validation evidence and open gates: `docs/testing/tauri-*.md`; OS/webview floors:
  `docs/technical/tauri-desktop-support.md`. Guard tests in Python:
  `app/tests/test_desktop_workflow.py`, `app/tests/test_sentry_desktop_contract.py`.

## File drops — Listen1BD

The main webview uses `dragDropEnabled:false` so native interception does not suppress
HTML5 file drops (required by WebView2 on Windows). Keep that flag in the Linux window-array
override as well. Listen UploadView stages `File` objects via its real drop target, then uses
the existing explicit upload action; there is no native path-reading bridge or broader fs scope.
The native file picker remains available. `src/lib/file-drop-config.test.ts` guards both hosts.
