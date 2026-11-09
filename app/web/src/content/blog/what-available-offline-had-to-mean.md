---
title: "What available offline had to mean"
description: "An offline badge was only useful if the file survived a restart and the player could find it. Crate had to make downloads, indexes and identity agree."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 21
related: [taking-crate-out-of-the-browser, keeping-the-music-playing-on-android, a-desktop-app-has-a-life-outside-its-window]
tags: [How to dismantle Spotify, offline, storage, history]
sources:
  - app/listen/src/lib/offline.ts
  - app/listen/src/lib/offline-native-assets.ts
  - app/listen/src/lib/offline-storage.ts
  - app/listen/src/lib/offline-web.ts
  - app/listen/src/lib/offline-native.ts
  - app/listen/src/lib/offline-identity.ts
  - app/listen/src/lib/offline-scheduler.ts
  - app/listen/src/app-shell/OfflineAccessRoute.tsx
  - app/listen/src/contexts/use-auth-session.ts
  - docs/technical/listen-offline-runtime-policy.md
---

_Part 21. Offline downloads, April 2026, and making them dependable across restarts and clients._

A download could finish with an empty file. Crate's native integrity checks accepted that file, put
it in the offline index and left the track looking available. Trying it without a connection produced
no music. Because the entry already existed, another attempt could reuse the same broken copy.

The bug was small: the size check treated zero as an acceptable result. The consequence reached all
the way to the UI. An offline badge was making a promise that the file underneath it could not keep.
We fixed the checks, but reliable offline playback also needed agreement between the downloaded
bytes, the index on disk, the selected account and the player rebuilding its queue after a restart.
[The zero-byte fix](https://github.com/thecrateapp/crate/commit/1085da4ea843b3fa1ec44f96f77cc405dc0ad7b5).

## Downloading a collection meant keeping a local catalogue

The first offline implementation supported tracks, albums and playlists. A manifest described what
to download: track identity, display metadata, stream and download URLs, byte length when known and
a content version for the collection. A local item record tracked the collection's state and which
of its tracks were ready.
[Initial offline model](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/listen/src/lib/offline.ts#L7-L65).

That extra metadata mattered. The player needed to show a title and rebuild an album or playlist
without asking the server. A file alone would not tell the interface which collection it belonged to
or how much of that collection had finished downloading. Conversely, a ready item in metadata was
not evidence that every referenced file still existed.

We used separate media storage for the browser and native clients. Web and PWA builds stored request
and response pairs in the Cache API. Capacitor used files in the application's data directory, with
an index mapping track identity to a local path and playback URL. Tauri later gained a filesystem
adapter and native transfer commands for its own application directory.
[Initial storage implementation](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/listen/src/lib/offline.ts),
[Tauri offline playback](https://github.com/thecrateapp/crate/commit/c2d9a6616595e20be80ed1662d7500a3083024c9).

The browser API provides named caches and leaves updates and deletion to the application. It also
operates under browser storage quotas and eviction rules. Native files offer a different storage
mechanism, but we still have to finish writes, maintain their index and handle missing files. Neither
adapter lets the UI infer availability from the fact that a download was once requested.
[MDN Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache),
[browser quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Reject the empty copy

Our earlier download check rejected a size mismatch only when both expected and actual sizes were
positive. An empty file fell outside that condition. The native verification implementations had
their own versions of the same mistake, so catching it during download would not repair older
entries when the app next opened.

We made nonzero size an unconditional requirement in the JavaScript check and in Android and iOS
verification. The download-time check became:

```typescript source="app/listen/src/lib/offline-native-assets.ts#L124-L140" commit="1085da4ea843b3fa1ec44f96f77cc405dc0ad7b5" "actualSize > 0"
  const actualSize = Number(stat.size || 0);
  const expectedSize = Math.max(0, Number(expectedBytes ?? 0));
  // A 0-byte file is never a valid asset, even when we have no expected
  // size to compare against — it means a download that started and
  // produced an empty file, not one that legitimately has no content.
  const isValid =
    actualSize > 0 && (expectedSize === 0 || actualSize === expectedSize);
  if (!isValid) {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    }).catch(() => {
      // best-effort cleanup on integrity failure
    });
    throw new Error("Offline copy failed integrity check");
  }
  return { uri: stat.uri, size: actualSize };
```

When the expected size is unknown, a nonempty file can still pass this check. When it is known, the
sizes must agree. This is a size-based integrity check, not a checksum or a full audio decode. It
detects empty and known-size incomplete downloads; it cannot prove that every byte in a same-sized
file is correct. For transformed audio, the expected size must describe the delivered file, which
can differ from the original library file.
[Delivered-size regression test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-native-assets.test.ts).

The browser adapter has a narrower check. It rejects failed HTTP responses and rejects a known
content-length mismatch when both lengths are available, then awaits `cache.put`. It does not run
the native filesystem verifier or decode the audio. Treating every runtime's offline indicator as
the result of an identical integrity procedure would overstate what the browser path does.
[Browser cache validation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-web.ts).

## Finish means publishing the file and its index

A valid file could still disappear from the offline library after a restart if its index entry had
not reached disk. We had updated the in-memory index and started a filesystem write without waiting
for it. That allowed the download operation to finish while the record needed by the next process
was still being written.

The September fix made native index persistence awaitable and awaited it after caching or deleting
assets. It closed that scheduling gap. Later work strengthened the publication sequence: write the
media to a temporary path, validate it, rename it, then persist the index before treating the new
entry as committed. Replacing an existing copy keeps the old asset until the new index has been
published.
[Awaited native index writes](https://github.com/thecrateapp/crate/commit/1085da4ea843b3fa1ec44f96f77cc405dc0ad7b5),
[current native asset publication](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-native-assets.ts).

The current metadata writer stages JSON in a `.next` file and reads it back before replacing the
current index:

```typescript source="app/listen/src/lib/offline-storage.ts#L438-L455" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "readNativeJsonFile"
async function writeNativeJsonFile(
  path: string,
  payload: unknown,
): Promise<void> {
  await ensureOfflineNativeMetaDir();
  const nextPath = `${path}.next`;
  const backupPath = `${path}.backup`;
  const data = JSON.stringify(payload);
  await Filesystem.writeFile({
    path: nextPath,
    directory: Directory.Data,
    recursive: true,
    encoding: Encoding.UTF8,
    data,
  });
  if ((await readNativeJsonFile(nextPath)) !== data) {
    throw new Error(`Failed to verify native metadata write: ${path}`);
  }
```

It retains a backup during replacement and can recover from that copy. Mutations are also serialized
per profile. Serializing only writes would still allow two callers to read the same old index and
later overwrite each other's additions; the mutation must read the current state inside that
serialized operation. A download completing while another asset is deleted is enough to expose
that distinction.
[Current index mutation and recovery](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-storage.ts).

![An offline download moves through a staged file, size validation, final asset and persisted index before appearing ready. On restart, the verified local identity selects its profile, the index is hydrated and files are checked before the player resolves a local URL.](/blog/what-available-offline-had-to-mean/offline-readiness.svg)

We also bounded the work around those writes. The manifest scheduler uses two concurrent transfers,
rechecks the storage budget before each one and waits when the page is hidden, offline, using Data
Saver or reporting a slow connection. Cancellation stops the remaining work while preserving assets
that were already completed. Routine progress snapshots are coalesced; terminal state is flushed
without waiting for the next progress timer.
[Transfer scheduler](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-scheduler.ts),
[manifest synchronization](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/use-offline-manifest-sync.ts).

Those rules deliberately limit background downloading. Keeping already downloaded music playable
is a different promise from continuing every download after the application is suspended. The
Tauri transfer bridge can cancel a native operation directly; the Capacitor path also checks
cancellation before publication, so an operation completing after cancellation must not become
a newly ready entry.
[Transfer cancellation and publication checks](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-native-assets.ts).

## Keep that copy with the account that downloaded it

Listen could connect to more than one Crate server, and a server could have more than one user. A
global cache keyed only by a numeric track ID would mix those contexts. The first profile key
combined server origin and user ID, then used that key in cache names, metadata keys and native
asset indexes.
[Original profile derivation](https://github.com/thecrateapp/crate/blob/8a71ad52360a18fff4e05cf7a9738a52b96a8e4b/app/listen/src/lib/offline.ts#L112-L123).

Track identity also had to survive changes in the catalogue. The current storage model prefers a
canonical entity identity and keeps legacy storage aliases where needed. Those aliases can point
to one physical asset, so summing every index entry would count the same file more than once. The
offline budget and cleanup logic need to reason about the asset those entries identify.
[Track identity adapter](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-track-identity.ts),
[alias and storage-budget regression tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-native-assets.test.ts).

An in-flight operation needed to retain its profile too. Switching servers while a transfer was
running must not publish its result into the newly selected account. The desktop transfer adapter
now registers each transfer with a scope containing server ID and URL, user ID, profile key,
identity generation and asset key. Cancellation addresses that registered transfer and scope.
[Scoped desktop transfers](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-tauri-transfer.ts).

### Reload the index before constructing the queue

During an ordinary session, the native asset index was already in memory. After a restart, resolving
a track too early could miss an offline file that was present on disk. The queue could be constructed
with a remote URL before the profile had loaded its local assets.

We changed profile initialization to await native hydration:

```typescript source="app/listen/src/lib/offline.ts#L1194-L1203" commit="84b43d8f595808c2485b83abd2be8dccf8e658e1" "hydrateOfflineProfileState"
export async function primeOfflineRuntimeProfile(
  serverOrigin?: string,
): Promise<void> {
  const profileKey = deriveOfflineProfileKeyFromStoredUser(serverOrigin);
  setActiveOfflineProfileKey(profileKey);
  if (isNative && profileKey) {
    await hydrateOfflineProfileState(profileKey);
  }
  await syncOfflineProfileToServiceWorker(profileKey);
}
```

The queue-loading paths also awaited this initializer before converting tracks for the native
engine. Loading the index after starting playback was too late: the player had already chosen where
to read the audio. The ordering had to be profile, assets, then engine queue.
[Queue initialization change](https://github.com/thecrateapp/crate/commit/84b43d8f595808c2485b83abd2be8dccf8e658e1).

Hydration eventually included verification of the indexed files. The native adapter checks bounded
batches of paths, compares expected sizes when available and removes invalid entries. Android and
iOS use their integrity bridges; older shells can fall back to filesystem checks. Tauri uses its
scoped verification command when available. Paths must stay inside the application's permitted data
directory. This also lets an upgraded frontend work with a shell that has not acquired the newer
batch command yet.
[Native verification adapter](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-native.ts),
[offline runtime policy](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/listen-offline-runtime-policy.md).

## Start with no network

Files and indexes were not enough if startup redirected the listener to login whenever the server
could not answer. We added a local offline identity after a verified online session. It records the
server, user and profile, with a generation that changes when identity is revoked. An unavailable
server can then lead to a local offline library for that identity, provided playable offline
content is present.
[Cold-start offline access](https://github.com/thecrateapp/crate/commit/7ada0918d6cdd4df47ffb485ade9364f183d7200),
[local identity model](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-identity.ts).

The route distinguishes this access from a live authenticated session:

```tsx source="app/listen/src/app-shell/OfflineAccessRoute.tsx#L9-L25" commit="7ada0918d6cdd4df47ffb485ade9364f183d7200" "accessMode"
export function OfflineAccessRoute() {
  const { user, loading, accessMode, offlineIdentity } = useAuth();

  if (accessMode === "loading" || (loading && !user)) return <AuthSpinner />;
  if (user) return <Navigate to="/" replace />;
  if (accessMode !== "offline" || !offlineIdentity) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PlayerProvider>
      <OfflineProvider>
        <OfflineLibrary />
      </OfflineProvider>
    </PlayerProvider>
  );
}
```

The offline player resolves local assets and reports a missing copy instead of silently falling
back to a remote stream. It does not need to renew a media ticket just to open a file it already
owns locally. Meanwhile, an explicit rejected session is different from a failed network request:
the current authentication path revokes offline identity on a 401 or 403. Logout also revokes it.
Remembering an offline identity must not override a rejection the application actually received.
[Offline engine-track resolution](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/player-engine-adapter.ts),
[authentication and offline fallback](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/use-auth-session.ts).

An offline badge now means something narrower and more honest than it did when an empty file could
earn one: the copy exists, its size matches, and the session that downloaded it has not been
rejected. Tests pin those rules down: revocation and cold-start access for the offline identity, and
empty files, mismatched sizes, failed index replacement, concurrent replacement during verification
and cancellation for native assets. The badge still cannot promise that the platform keeps the file.
Browsers evict caches, phones suspend downloads, and installed desktop runtimes have not yet been
checked offline on real machines.
[Native asset tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-native-assets.test.ts),
[offline identity tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/offline-identity.test.ts).
