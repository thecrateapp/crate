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
  `{macos,linux,windows}_media_controls.rs`, `desktop_window_bounds.rs`.
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
smoke), `test-frontend.yml` (typecheck + vitest) and `test-native-tools.yml`
(`cargo fmt --check` with Rust 1.88). Clippy is not gated in CI because the vendored
Wry warns; validation docs record `cargo clippy --locked --all-targets ... -D warnings`
as the local bar for first-party code.

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
