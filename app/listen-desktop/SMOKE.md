# Crate Desktop Smoke Checklist

Use this checklist before merging desktop changes or publishing desktop artifacts.

## Build Smoke

Run the platform build:

```bash
npm run --workspace=app/listen-desktop tauri:build:macos
npm run --workspace=app/listen-desktop tauri:build:linux
npm run --workspace=app/listen-desktop tauri:build:windows
```

Then collect artifacts:

```bash
app/listen-desktop/scripts/collect-artifacts.sh local
```

Expected artifacts:

- macOS: `crate-macos-<version>.app.zip`
- Linux: `.AppImage`, `.deb`, `.rpm`
- Windows: `.exe` and/or `.msi`

## First Launch

- App opens one main window named `Crate`.
- App opens in the desktop shell, not the mobile bottom-nav layout.
- First-run and restored window size are at least 1024x700.
- Server setup is shown when no server is configured.
- `https://api.lespedants.org` connects successfully.
- Restarting the app preserves the selected server.
- A second launch focuses the existing window instead of opening another app instance.

## Auth

- Email/password login completes and lands in Listen, not Admin.
- Google OAuth opens the external browser.
- OAuth callback returns to the existing desktop window.
- App restart preserves the authenticated session.
- Logout clears the session and stops active playback.

## Playback

- Album play starts the first track.
- Next/previous controls work from the player UI.
- Playback works with original quality when supported by the platform webview.
- Switching tracks does not create duplicate audio streams.
- Buffering recovers after a network pause or app background/foreground cycle.
- System media controls show title, artist, album, progress, and album artwork.
- System media keys control play/pause, previous, and next.

## Tray And Window Controls

- Tray icon is visible and fits the host platform.
- macOS/Linux tray icon is monochrome/template-style.
- Windows tray icon is colored.
- Closing the main window hides it instead of quitting the app.
- Hidden playback keeps running.
- Tray menu shows current title/artist text.
- Tray `Play / Pause`, `Previous`, and `Next` control playback.
- Tray `Show Crate` focuses the existing window.
- Tray `Hide Crate` hides the main window without quitting playback.
- Tray `Quit Crate` exits the app.

## Platform-Specific

### macOS

- Dock right-click menu shows `Play / Pause`, `Previous`, and `Next`.
- Dock menu actions control playback.
- Clicking the Dock icon reopens the hidden main window.
- App icon size matches other macOS app icons.
- Window close hides to Dock/tray; `Quit Crate` or system Quit exits.

### Linux

- `.desktop` launcher opens the app.
- `.desktop` launcher actions trigger `Play / Pause`, `Previous`, and `Next`.
- Tray menu opens with right click.
- Left click on tray focuses the existing window.
- Window close hides to tray; `Quit Crate` exits.

### Windows

- Installer launches the app after install.
- WebView2 bootstrapper runs if WebView2 is missing.
- Tray menu opens from the notification area.
- Left click on tray focuses the existing window.
- Window close hides to tray; `Quit Crate` exits.
- Native taskbar Jump List is not required yet; verify once Windows QA is available.
