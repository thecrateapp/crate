---
title: Crate Desktop support
summary: Minimum operating system and webview versions supported by Crate Desktop.
section: reference
audience: [user, operator, developer]
status: canonical
order: 25
verified: 2026-10-01
sources:
  - app/listen-desktop/src-tauri/tauri.conf.json
  - app/listen-desktop/scripts/desktop-version.node-test.mjs
  - .github/workflows/build-desktop.yml
---

# Crate Desktop support

Crate Desktop requires the following operating system and webview versions.

| Platform | Minimum supported version                                                                           | Package or installer behavior                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | Big Sur 11.0                                                                                        | The app bundle declares `LSMinimumSystemVersion=11.0`.                                                                                                                   |
| Windows  | Windows 10 version 1803 (build 17134), with WebView2 Runtime 111.0.1661.34 or newer                 | NSIS and MSI installers use Tauri's WebView2 bootstrapper and minimum-version setting. Installing or updating WebView2 requires an internet connection.                  |
| Linux    | DEB/RPM: WebKitGTK 4.1 version 2.40.0 or newer. AppImage: tested with its bundled WebKitGTK 2.50.4. | DEB and RPM use the host WebKitGTK runtime. The tested AppImage bundles WebKitGTK and JavaScriptCoreGTK. Its minimum host distribution is not independently established. |

The Linux package dependency names are `libwebkit2gtk-4.1-0` for DEB and
`webkit2gtk4.1` for RPM. The WebKitGTK 2.40 minimum applies to those packages.
The AppImage from [Build Desktop Apps run 36815596145](https://github.com/thecrateapp/crate/actions/runs/36815596145)
contains WebKitGTK and JavaScriptCoreGTK 2.50.4, including both WebKit helper
processes. The Linux artifact verifier checks that these runtime files remain in
the AppImage. AppImage compatibility still depends on the host libraries it does
not bundle; the supported minimum distribution has not been independently
validated.

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
