---
title: Crate Desktop support
summary: Minimum operating system and webview versions supported by Crate Desktop.
section: reference
audience: [user, operator, developer]
status: canonical
order: 25
verified: 2026-09-30
sources:
  - app/listen-desktop/src-tauri/tauri.conf.json
  - app/listen-desktop/scripts/desktop-version.node-test.mjs
---

# Crate Desktop support

Crate Desktop requires the following operating system and webview versions.

| Platform | Minimum supported version                                                           | Package or installer behavior                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Big Sur 11.0                                                                        | The app bundle declares `LSMinimumSystemVersion=11.0`.                                                                                                  |
| Windows  | Windows 10 version 1803 (build 17134), with WebView2 Runtime 111.0.1661.34 or newer | NSIS and MSI installers use Tauri's WebView2 bootstrapper and minimum-version setting. Installing or updating WebView2 requires an internet connection. |
| Linux    | A distribution with WebKitGTK 4.1 version 2.40.0 or newer                           | DEB and RPM packages declare the WebKitGTK minimum. AppImage still uses the host's WebKitGTK runtime.                                                   |

The Linux package dependency names are `libwebkit2gtk-4.1-0` for DEB and
`webkit2gtk4.1` for RPM. Linux also needs the GTK and media runtime dependencies
reported by the package format. AppImage does not bundle WebKitGTK, so check the
host distribution's installed version before running it.

Linux release binaries must remain compatible with GLIBC 2.36 or older so the
packages run on Debian 12. CI builds them on Ubuntu 22.04 and rejects a binary
that requires a newer GLIBC. Keep this check if the build runner changes; move
the build into a Debian 12 based environment before Ubuntu 22.04 runners retire.

The Windows version is the supported operating-system floor. The Tauri
configuration asks the installer to ensure WebView2 111.0.1661.34 or newer;
the standard Tauri configuration does not make NSIS or MSI reject an older
Windows version explicitly.

These floors align the embedded browsers with the frontend's CSS requirements:
Tailwind CSS 4 requires Safari 16.4, Chrome 111, or Firefox 128. See the
[Tailwind browser compatibility table](https://tailwindcss.com/docs/compatibility)
and [Tauri's WebView2 installer documentation](https://v2.tauri.app/distribute/windows-installer/).
