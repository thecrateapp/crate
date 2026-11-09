---
title: "A desktop app has a life outside its window"
description: "Crate reused Listen in Tauri, then had to define what close, media keys and login links meant when the window was hidden or still starting."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 15
related: [taking-crate-out-of-the-browser, keeping-the-music-playing-on-android, one-library-more-than-one-listener]
tags: [How to dismantle Spotify, desktop, Tauri, history]
sources:
  - app/listen-desktop/src/main.tsx
  - app/listen-desktop/vite.config.ts
  - app/listen-desktop/src/lib/tauri-init.ts
  - app/listen-desktop/src-tauri/src/lib.rs
  - app/listen-desktop/src-tauri/src/macos_media_controls.rs
  - app/listen-desktop/src-tauri/src/linux_media_controls.rs
  - app/listen-desktop/src-tauri/src/windows_media_controls.rs
  - app/listen-desktop/src-tauri/src/secure_session.rs
  - app/listen-desktop/src-tauri/tauri.conf.json
  - app/listen/src/lib/server-store-native.test.ts
  - docs/technical/tauri-desktop-support.md
---

_Part 15. The Tauri shell, May 2026, and the runtime work that followed._

Listen already worked in a desktop browser, but its lifetime belonged to a tab. Turning it into a
desktop music player meant letting someone close the window without closing the player, then
control it from media keys or the system tray. Login callbacks also had to find that running
application, including while it was still starting.

We built Crate Desktop around the existing Listen application. That let the same React screens run
inside a Tauri window, with Rust handling desktop integration. The first build was enough to open
the library. Making it behave like a music application required a contract between the window, the
web runtime and operating-system events that could arrive while nobody was looking at the screen.

## Close the window and press Next

The mobile work had already separated Listen from the server that served its JavaScript. A packaged
client could ask for a Crate instance and use authenticated requests to that server. Desktop reused
that foundation and the same application source.
[The first installed client](/blog/taking-crate-out-of-the-browser).

Tauri combines a Rust application with a web frontend. Its desktop webviews use WKWebView on macOS,
WebKitGTK on Linux and WebView2 on Windows. Electron offers another way to reuse a web interface,
bundling Chromium and Node.js with the application. The distinction matters here because choosing
Tauri made each host's webview part of Crate's runtime. It did not make a frontend tested in one
browser behave identically on every desktop.
[Tauri architecture](https://v2.tauri.app/concept/architecture/),
[Tauri webview platforms](https://v2.tauri.app/reference/webview-versions/),
[Electron's runtime model](https://www.electronjs.org/docs/latest/).

Our desktop Vite configuration pointed the `@` alias at `app/listen/src` and reused Listen's public
assets. The desktop entry imported Listen's `App` and rendered it under a `HashRouter`. Routes could
then stay inside the packaged application's URL fragment instead of requiring a web server to serve
each path. The desktop package owned initialization and native integration; it did not contain a
second copy of the library screens.
[Initial desktop entry](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/src/main.tsx),
[Vite source aliases](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/vite.config.ts).

Listen also imported Capacitor modules. The desktop build replaced those imports with adapters or
stubs, while `isTauriRuntime` identified the actual environment. The Capacitor core stub reported that
it was not a native Capacitor platform. That prevented an installed desktop window from accidentally
selecting Android-only playback code merely because both builds were called native.
[Capacitor compatibility layer](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/src/lib/stubs/capacitor-core.ts),
[runtime identification](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen/src/lib/platform.ts).

### Close hid the window; Quit ended the application

The initial window handler intercepted the main window's close request:

```rust source="app/listen-desktop/src-tauri/src/lib.rs#L334-L346" commit="24ac33f72edc3058da0be5fbd1dafd80dcf672be" "prevent_close"
fn handle_window_lifecycle_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if window.label() != "main" {
        return;
    }

    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}
```

Hiding preserved the window and its web runtime. The tray supplied explicit Show, Hide and Quit
actions, and Quit called `app.exit(0)`. On macOS, reopening the application with no visible windows
showed the existing main window again. Close kept the player alive; Quit ended it.
[Initial menu and reopen behaviour](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/src-tauri/src/lib.rs#L318-L362).

This was a different design from the [Android playback service](/blog/keeping-the-music-playing-on-android).
Desktop kept the web audio engine alive inside the hidden webview. Rust managed the surrounding
application and its controls; it did not replace that engine with ExoPlayer or another native decoder.
If the web runtime stopped making progress, a healthy tray icon alone could not keep the audio working.

![Native desktop controls and deep links enter the Rust shell, which forwards commands to Listen's existing web player. Hiding keeps the main webview alive; quitting ends the app. Startup links wait for the frontend-ready handshake.](/blog/a-desktop-app-has-a-life-outside-its-window/window-and-runtime.svg)

## One transport command, several operating systems

The tray menu, macOS Dock menu and system media keys all needed to produce the same transport
operations. The shell emitted a `crate:tray-command` event. Listen's runtime bridge delivered it to
the player callbacks for play, pause, previous and next. Now Playing information travelled the other
way, from the player to the shell and its native media integration.
[Original player command hook](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen/src/contexts/use-desktop-tray-commands.ts),
[desktop event bridge](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen-desktop/src/lib/tauri-init.ts).

Window focus was part of the command's behaviour. The first tray actions showed the main window before
emitting the command, while macOS system media commands left it hidden. We later made the tray's
transport actions leave the window alone too. Pressing Next could change the track without taking
focus from the application the listener was using. Show remained a separate action.
[Initial focus policy](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/src-tauri/src/lib.rs#L296-L316),
[current command dispatch](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen-desktop/src-tauri/src/lib.rs#L1040-L1061).

The OS adapters arrived at different stages. The initial shell included macOS remote commands and
Now Playing integration. Linux gained MPRIS integration, and Windows later gained System Media
Transport Controls. They exposed similar actions through different APIs:

| Platform | Native integration | Shared boundary |
| --- | --- | --- |
| macOS | `MPRemoteCommandCenter` and `MPNowPlayingInfoCenter` | Playback commands into Listen; track state back to the OS |
| Linux | MPRIS over D-Bus | The same commands and metadata, including MPRIS position units |
| Windows | System Media Transport Controls | The same commands and metadata, using Windows timeline types |

[macOS adapter](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/src-tauri/src/macos_media_controls.rs),
[Linux integration](https://github.com/thecrateapp/crate/commit/7865aaded65a75a8d2647362ae23af8c8b3f77d6),
[Windows adapter and shared command type](https://github.com/thecrateapp/crate/commit/b20355ee12e33a65137b30ef9c42e6ae6f07ed79).

We consolidated the command strings into a Rust `PlaybackCommand` enum with one parser and one
wire-format mapping. That reduced the chance that a menu item, a platform callback and the React
listener disagreed over a command name. The current integrations also distinguish a new track's
metadata from position updates, so moving the progress cursor does not require replacing all the
Now Playing information on every tick.
[Command mapping](https://github.com/thecrateapp/crate/blob/b20355ee12e33a65137b30ef9c42e6ae6f07ed79/app/listen-desktop/src-tauri/src/lib.rs#L89-L138),
[incremental media-control updates](https://github.com/thecrateapp/crate/commit/7de01fb8e009a0614953f1a3ee6c1e3a590c01a2).

## A login callback beats React to startup

Opening a `cratemusic://` link can start the application or activate an existing one. On Linux and
Windows, Tauri receives deep links as arguments to a new process; its single-instance integration
can forward them to the existing app. Crate used that integration alongside the platform's open-URL
events. This let a callback return to the application that initiated login instead of creating an
independent player window.
[Tauri deep-link delivery](https://v2.tauri.app/plugin/deep-linking/),
[Crate's initial plugin setup](https://github.com/thecrateapp/crate/blob/24ac33f72edc3058da0be5fbd1dafd80dcf672be/app/listen-desktop/src-tauri/src/lib.rs#L499-L550).

Delivery to the process was only the first step. The native shell could receive the callback before
the frontend had registered its event listener. Emitting an event at that moment could lose the
callback even though the operating system had opened the correct application.

We added a buffer with an explicit readiness handshake:

```rust source="app/listen-desktop/src-tauri/src/lib.rs#L94-L107" commit="4966f9b0176913b04f53f62a2c6fd455677043e5" "frontend_ready"
impl DeepLinkBuffer {
    fn dispatch(&mut self, urls: Vec<String>) -> Option<Vec<String>> {
        if self.frontend_ready {
            return Some(urls);
        }
        self.pending_urls.extend(urls);
        None
    }

    fn mark_ready(&mut self) -> Vec<String> {
        self.frontend_ready = true;
        std::mem::take(&mut self.pending_urls)
    }
}
```

The frontend first subscribed to `crate:deep-link`, then called `register_deep_link_listener` to
mark itself ready and retrieve anything already buffered. It also read launch URLs from Tauri's
plugin and merged the initial lists without duplicates. A link arriving before the handshake was
returned from the buffer; one arriving afterwards could use the registered listener.
[Frontend readiness ordering](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen-desktop/src/lib/tauri-init.ts#L152-L180).

This solves an event-delivery race. It does not make a received URL trustworthy. The callback still
goes through the shared OAuth consumer, which validates it against the pending login transaction.
A cancelled login, a provider failure and a completed account link also have different UI results;
none should be reported as a newly authenticated session just because a callback reached the app.
[Callback handling and regression tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen-desktop/src/lib/tauri-init.test.ts),
[shared OAuth consumer](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/capacitor-oauth.ts).

## Desktop privileges needed narrow adapters

The installed frontend had another origin, much like the first Capacitor build. Tauri's HTTP plugin
let the application make API requests through the native runtime. That was useful for connecting to
a selected Crate server, but sending every request through that bridge was not automatically the
right choice for audio.

The current adapter uses browser streaming fetch for media paths in a packaged Tauri origin allowed
by the API's CORS policy. Ordinary eligible HTTP requests use the native plugin. Development still
needs its own path because the Vite origin is different. An API response and a long audio response
have different costs when the plugin proxies response bodies through native resource IDs.
[HTTP and media-path selection](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen-desktop/src/lib/tauri-init.ts#L85-L125).

Credentials acquired a native adapter too. The first desktop client inherited sessions in WebView
storage. In September we moved Tauri session and transient OAuth records into the operating system's
credential vault through the Rust `keyring` API. The frontend calls three commands: get, set and
remove. Rust validates the record key and size before accessing the vault.
[Native session-store implementation](https://github.com/thecrateapp/crate/commit/438c851c90dc9387863ac2ac2e77e0b7895aa021).

The read path distinguishes an absent entry from a vault failure:

```rust source="app/listen-desktop/src-tauri/src/secure_session.rs#L44-L52" commit="013a2c63ce1b269fd9d1ea3f6914de342a892c34" "KeyringError::NoEntry"
fn read_secure_session(service: &str, key: &str) -> Result<Option<String>, String> {
    let entry = secure_entry(service, key)?;
    match entry.get_password() {
        Ok(value) if value.len() <= MAX_VALUE_BYTES => Ok(Some(value)),
        Ok(_) => Err("invalid secure session value".into()),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err("secure session store unavailable".into()),
    }
}
```

Returning `None` for every failure would make a locked or unavailable vault look like an empty one.
Bootstrap instead waits for migration and presents a recoverable error if secure storage fails.
Migration copies a legacy secret, reads it back and verifies the result before removing credentials
from public server metadata. If a newer secure record already exists, it takes precedence over stale
plaintext. Development builds use a separate `.dev` vault service name so testing does not reuse
the installed release's entries.
[Current migration](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/server-store-secrets.ts),
[Tauri migration regression tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/server-store-native.test.ts),
[development vault isolation](https://github.com/thecrateapp/crate/commit/013a2c63ce1b269fd9d1ea3f6914de342a892c34).

The storage adapter depends on the OS granting access to its credential store. A denied or unavailable vault blocks authentication bootstrap; it does not
silently select a plaintext replacement.
[Desktop bootstrap](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen-desktop/src/main.tsx).

## A hidden window still had a browser lifecycle

Keeping the window alive exposed a macOS failure later in the desktop work. After the app had been
hidden with playback paused, WKWebView could suspend its WebContent runtime. Returning to the window
could leave the audio context reporting that it was running while playback produced no sound. A
reload recreated the context, but that was a poor recovery for a music application whose window was
supposed to stay out of the way.
[The macOS idle-audio fix](https://github.com/thecrateapp/crate/commit/ccb7f860779773493d03be117099c92808cc4b4c).

We disabled background throttling for the main webview:

```json source="app/listen-desktop/src-tauri/tauri.conf.json#L20-L24" commit="ccb7f860779773493d03be117099c92808cc4b4c" "backgroundThrottling"
        "minWidth": 1024,
        "minHeight": 700,
        "resizable": true,
        "fullscreen": false,
        "backgroundThrottling": "disabled"
```

The setting changes a specific webview policy. Tauri supports it on macOS 14 and newer; Linux and
Windows do not implement this option. Disabling suspension also means retaining background work
that the webview would otherwise suppress. It is not a measured battery improvement or a guarantee
for every macOS version Crate can launch on.
[Tauri background-throttling support](https://v2.tauri.app/reference/config/#backgroundthrottling).

The same platform differences shaped packaging. Windows installers had to account for WebView2.
Linux DEB and RPM packages depended on the host WebKitGTK, while the tested AppImage carried its own
WebKitGTK runtime. That is the same lesson as the window itself: a player that survives closing on one
platform has not shown it survives on another. The support document lists each platform's
requirements, and the validation record keeps minimum-host, upgrade and installed-player checks apart
from what CI builds.
[Desktop support requirements](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/tauri-desktop-support.md),
[desktop validation record](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/testing/tauri-hardening-validation-2026-09-30.md).
