---
title: "Taking Crate out of the browser"
description: "Bundling Listen for a phone broke its same-origin assumptions. We separated app and server, then made authentication and navigation follow that split."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 9
related: [one-library-more-than-one-listener, taking-playback-over-from-navidrome, filesystem-to-indexed-catalogue]
tags: [How to dismantle Spotify, Capacitor, mobile, history]
sources:
  - app/listen/capacitor.config.ts
  - app/listen/src/lib/api.ts
  - app/listen/src/lib/server-store.ts
  - app/listen/src/lib/capacitor-runtime.ts
  - app/listen/src/lib/capacitor-init.ts
  - app/listen/src/lib/library-routes.ts
  - app/listen/src/lib/server-store.test.ts
  - app/listen/src/lib/capacitor-runtime.test.ts
  - docs/technical/listen-media-access.md
  - docs/technical/listen-native-auth-contract.md
---

_Part 9. The first Capacitor builds and a server the listener could choose, April 2026._

In the browser, Listen could fetch `/api/auth/me` without knowing the address of the backend. The web
server handled the routing. The browser attached the session cookie, and the same origin served album
covers and audio.

Bundling that application for a phone removed the web server from the middle. The JavaScript now came
from files inside the app. A relative `/api` URL no longer identified the Crate instance holding the
music. Fixing the JSON client was only part of the change: images, audio and the requests made directly
by the player all needed a destination and a way to authenticate.

We used Capacitor to keep Listen's React interface and add a native shell. Getting it installed meant
separating the application from the server it connected to. Getting it usable meant following that
separation through login, artwork, navigation and the app's return from the background.

## A home-screen app was already an option

Listen already had a web manifest, icons and a small service worker. A listener could add the web app
to the home screen instead of opening a browser tab for each session. We continued to support that
route while building the native shell.

A PWA can be installed and launched as an application while retaining its web origin. Installation
details differ between browsers and operating systems; it does not require the site to become an
Android or iOS binary.
[MDN's PWA installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing).

Our service worker cached the app shell and deliberately skipped `/api/` and `/stream/` requests. It
could help the interface load again without fetching its initial HTML, but it did not download the
music collection. We had to keep that distinction clear: an installed icon and cached interface did
not promise offline playback.
[The early service worker](https://github.com/thecrateapp/crate/blob/aa7059942e4dfc250fd463bfe187a1fb484b4c4a/app/listen/public/sw.js).

Capacitor gave us a second delivery route for the same interface. Its normal workflow builds the web
assets, copies them into native projects with `cap sync`, then builds those projects with the platform
tooling. Crate's `build:cap` script ran the TypeScript build, Vite's Capacitor mode and that sync step;
`webDir` pointed at Vite's `dist` directory.
[Capacitor's build workflow](https://capacitorjs.com/docs/basics/workflow),
[Crate's first native build scripts](https://github.com/thecrateapp/crate/blob/a3c46ea3db210e8583b71d2c72ddc9c93762b155/app/listen/package.json#L6-L13).

We kept the React pages and player UI. Native plugins supplied capabilities such as app lifecycle
events and control over the status bar. That avoided rebuilding the catalogue screens in another UI
framework, but the screens still ran in a WebView. Their network requests and audio element did not
become native services just because the app had an installable package.

## Follow /api/auth/me out of the website

Our initial Capacitor configuration set `server.url` to the deployed Listen site. The shell opened
that remote page, so the site's origin still determined where its relative requests went. This was
close to putting a native window around the existing deployment.
[Initial Capacitor configuration](https://github.com/thecrateapp/crate/blob/a3c46ea3db210e8583b71d2c72ddc9c93762b155/app/listen/capacitor.config.ts#L3-L17).

We removed that URL and loaded the bundled assets instead. The API gained its own exposed subdomain,
and the native build received an absolute API base through `VITE_API_URL`. The web build kept an empty
base, so its existing proxy and relative requests continued to work.
[The move to a local bundle and separate API](https://github.com/thecrateapp/crate/commit/1ca3f18cfc4d6e892a782664dfb75d006e2e1756).

Capacitor's configuration reference makes the distinction explicit: `server.url` loads an external
page and is intended for live reload, while `webDir` identifies the compiled assets to package. The
local bundle gave the installed client its own copy of the UI. It still needed a reachable server to
browse uncached data or stream a track.
[Capacitor configuration](https://capacitorjs.com/docs/config).

We also stopped registering the web service worker inside the native shell. The native package now
provided the application files; it did not need the browser's shell cache to choose another copy of
them. Web and PWA builds retained their registration path.
[Service-worker registration guard](https://github.com/thecrateapp/crate/blob/a3c46ea3db210e8583b71d2c72ddc9c93762b155/app/listen/index.html#L16-L24).

![Web Listen sends relative API requests through its own host. The installed client loads a local bundle and resolves requests using a selected server URL and that server's token.](/blog/taking-crate-out-of-the-browser/two-origins.svg)

### An API base fixes the address, not the session

Once the bundle and API lived at different origins, cookie authentication needed different handling.
The first adjustment allowed the native origins through the API's CORS middleware and changed the
cookie's SameSite setting. We then added bearer authentication for native requests: login returned a
token in the response body, the client stored it, and subsequent API calls supplied it in the
`Authorization` header. Browser requests continued to use cookies.
[CORS and cookie changes](https://github.com/thecrateapp/crate/commit/1ca3f18cfc4d6e892a782664dfb75d006e2e1756),
[native bearer authentication](https://github.com/thecrateapp/crate/commit/cd6f353e19eb90236cc4887087386de24eac70f6).

This changed how the client presented the login described in
[the account chapter](/blog/one-library-more-than-one-listener). It did not give the native app a
different user model. The backend still resolved the token to the Crate account making the request.

Putting a bearer header on our shared API client did not cover every request. The player and its
play-event tracker also called `fetch` directly. We added `apiFetch` to supply both the base URL and
authentication headers for those calls. Otherwise, a page could load through the corrected client
while its player continued sending requests to the local origin.
[Native request wrapper and player changes](https://github.com/thecrateapp/crate/commit/cd6f353e19eb90236cc4887087386de24eac70f6).

Images exposed a different boundary. An `<img>` does not call our API wrapper, so setting headers in
that wrapper does nothing for its `src`. Its URL needed to be ready for the WebView to request
directly. JSON routes, by contrast, needed to remain relative because the API wrapper would prefix
them. Prefixing them in both places produced the wrong URL.

We split the route helpers by who would consume their result:

```typescript source="app/listen/src/lib/library-routes.ts#L34-L41" commit="de9379608807a90f8cc8efddbf675c8c93c865d5" "authedUrl"
// These are passed to useApi/api() which already prepends API_BASE — no prefix here
export const artistApiPath = _artistApiPath;
export const albumApiPath = _albumApiPath;
export const albumRelatedApiPath = _albumRelatedApiPath;

export const artistPhotoApiUrl = authedUrl(_artistPhotoApiUrl);
export const artistBackgroundApiUrl = authedUrl(_artistBackgroundApiUrl);
export const albumCoverApiUrl = authedUrl(_albumCoverApiUrl);
```

At this stage, `authedUrl` built an absolute URL and appended the login token as a query parameter.
The audio element also gained an explicit cross-origin setting. Those changes made the request paths
usable outside the browser's original cookie context, but they carried costs: reusable credentials
now appeared in media URLs, and the native token was stored in `localStorage`.
[Historical media URL helper](https://github.com/thecrateapp/crate/blob/de9379608807a90f8cc8efddbf675c8c93c865d5/app/listen/src/lib/library-routes.ts#L21-L32),
[audio-element change](https://github.com/thecrateapp/crate/commit/de9379608807a90f8cc8efddbf675c8c93c865d5).

We later replaced that media-URL credential pattern with scoped media tickets and moved Capacitor
session secrets into native secure storage. The distinction between an API request and a URL consumed
by a media element survived; the authorization carried by the latter became much narrower. The first
mobile client should not be mistaken for today's authentication design.
[Current media access contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/listen-media-access.md),
[current native authentication contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/listen-native-auth-contract.md).

## Now make the destination changeable

An absolute API URL in a build setting worked for a client aimed at our deployment. A downloadable APK
needed to work with someone else's server too. Rebuilding the app for every instance would have tied
client distribution to server configuration.

We left `VITE_API_URL` empty in the public native build and added a first-run setup page. The web app
still knew its instance from the host that served it. The installed app asked the listener for a server
URL before taking them to login.
[Public-build configuration](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/.env.capacitor),
[native setup routing](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/src/App.tsx#L127-L148).

Setup could not use the ordinary API client yet, because that client read the selected server and
there wasn't one. It made an unauthenticated request to the candidate URL instead:

```typescript source="app/listen/src/pages/ServerSetup.tsx#L25-L44" commit="47b31ee7ca8947ed523c083d3f76bf28d1e685a7" "hasKnownField"
async function probe(url: string): Promise<ProbeState> {
  try {
    const response = await fetch(`${url}/api/auth/config`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      // Upstream responded but not with 2xx. If it's a 404 the URL is
      // reachable but almost certainly isn't a Crate instance.
      return { status: "not-crate" };
    }
    const data = await response.json();
    if (data == null || typeof data !== "object") {
      return { status: "not-crate" };
    }
    // /api/auth/config returns { invite_only: bool, google: bool, ... }
    // — the presence of the config shape is enough to consider it Crate.
    const hasKnownField =
      "invite_only" in data || "google" in data || "apple" in data;
    if (!hasKnownField) return { status: "not-crate" };
```

The probe caught common mistakes such as entering a website that did not expose Crate's API. It was
a response-shape check, not proof of the operator's identity or a complete compatibility negotiation.
The person still had to choose the server they intended to trust.

The new server registry stored an ID, label, base URL and token for each configured instance. It also
stored the selected server ID. Updating a token changed the selected record, so signing into one
instance no longer overwrote a single global token for the entire installation.
[First server registry](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/src/lib/server-store.ts#L25-L34),
[per-server token update](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/src/lib/server-store.ts#L147-L153).

The API base became a function of the current selection:

```typescript source="app/listen/src/lib/api.ts#L35-L39" commit="47b31ee7ca8947ed523c083d3f76bf28d1e685a7" "getCurrentServer"
export function getApiBase(): string {
  if (!isNative) return "";
  const server = getCurrentServer();
  return server?.url || BUILD_TIME_DEFAULT;
}
```

The request wrapper called this getter each time, and the header builder read the token from that
same selected server. Web requests still received an empty base and followed the original route.
[Request and header construction](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/src/lib/api.ts#L71-L119).

That made the next request use the new destination. It did not make every existing screen or prepared
media URL switch safely in place. Some older consumers still read an `API_BASE` constant captured when
the module loaded. The settings action reloaded the app when switching to a server with a
stored token; without a token it navigated to login.
[Compatibility alias](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/src/lib/api.ts#L41-L46),
[initial server-switch behaviour](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/app/listen/src/components/settings/ServersSection.tsx#L44-L56).

A reload gave the new server a fresh React tree and fresh request construction. Persistent player
state, offline data and late authentication responses needed their own isolation rules as the client
grew. A per-server token was the first piece of that work, not a guarantee that every local cache was
already partitioned correctly.

Later client tests check the contracts this first version introduced: adding and selecting
servers, updating only the addressed server's credentials, rejecting credentials for a removed
server, and removing native lifecycle listeners. Later tests also cover secure-storage migration
without discarding the previous credentials when verification fails. Those are separate contracts
from proving background audio on a physical phone.
[Server-store tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/server-store.test.ts),
[lifecycle adapter tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/capacitor-runtime.test.ts),
[secure-storage migration tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/server-store-native.test.ts).

## Navigation and lifecycle belonged to the shell

The server was only one assumption supplied by a browser tab. The browser also provided a Back button
and controlled how its chrome occupied the screen. In the installed app, those interactions had to
agree with the native shell.

We added an Android Back handler that called `window.history.back()` when the WebView could go back
and `App.exitApp()` otherwise. It connected the native button to the existing page history instead of
introducing a second navigation stack. Status-bar settings and safe-area padding kept the web header
away from the phone's system UI. Overscroll styling prevented the background behind the page from
showing through with a different colour.
[Initial Back handler](https://github.com/thecrateapp/crate/blob/884f0c904ded74f9996f2a9219431f189e774306/app/listen/src/lib/capacitor.ts#L23-L30),
[mobile layout changes](https://github.com/thecrateapp/crate/commit/de9379608807a90f8cc8efddbf675c8c93c865d5).

Capacitor's App plugin exposes foreground and background events from the platform lifecycle. We put
small adapters around these events so callers could register a callback and dispose of it without
knowing the plugin API. The adapter returned a no-op cleanup outside native builds.
[Capacitor App lifecycle events](https://capacitorjs.com/docs/apis/app#addlistenerresume-).

```typescript source="app/listen/src/lib/capacitor.ts#L45-L50" commit="884f0c904ded74f9996f2a9219431f189e774306" "handle.then"
/** Register a callback for when the app comes back to foreground. */
export function onAppResume(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = App.addListener("resume", callback);
  return () => { handle.then((h) => h.remove()); };
}
```

Listener registration returned a promise. Cleanup therefore waited for the handle before removing
the listener, including when the caller disposed of the adapter before registration completed. The
same pattern wrapped pause events; network status came from the native plugin on a device and
`navigator.onLine` on the web.

Receiving a resume event did not make the audio engine independent of the WebView. The first shell
still used the web player's audio element and JavaScript state. Keeping playback alive when Android
put that runtime to sleep required the later native service, which has its own chapter. The shell now supplied the lifecycle signals the web build received through the browser.

## Shipping the client we had actually built

The Android project initially lived outside version control. We started tracking its Gradle files,
manifest and native sources while ignoring build output and generated web assets. That preserved
native changes and let CI build from the checked-out project.

The first Android workflow built the web bundle, ran Capacitor sync and called Gradle's
`assembleDebug`. Tag builds attached the APK to the GitHub release, including a stable filename for
the website's download link. It was explicitly a debug beta package, not a claim of store
distribution or production signing.
[First APK build workflow](https://github.com/thecrateapp/crate/blob/47b31ee7ca8947ed523c083d3f76bf28d1e685a7/.github/workflows/build-android.yml).

The website presented two installation paths: download the Android APK, or add Listen to the iPhone
home screen through Safari. The iOS Capacitor work and its platform-specific fixes were real, but
they did not mean that an iOS native release was already available through the same public route.
We kept improving the PWA manifest and Apple icon metadata alongside the Android package.
[Installation paths and PWA metadata](https://github.com/thecrateapp/crate/commit/aa7059942e4dfc250fd463bfe187a1fb484b4c4a).
