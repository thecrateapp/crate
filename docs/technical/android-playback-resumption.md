# Android playback resumption

Crate persists a minimal native playback checkpoint so Android can retain a
paused media session after the WebView or application process is recreated.

The checkpoint contains only:

- queue revision and safe track identities;
- title, artist, album and credential-free artwork location;
- current index and position;
- repeat mode and prior playback intent.

It never contains stream URLs, bearer headers, media tickets, refresh tokens
or server secrets. Artwork query strings are removed before persistence.

After process recreation Media3 restores metadata in a paused,
authorization-pending state. A play/prepare request opens Crate and emits
`resumeAuthorizationRequired`; the React player rebuilds the native queue from
its persisted logical queue using fresh authenticated stream requests. Until
that succeeds, Media3 rejects the play command instead of retrying a stale
remote URL.

If Crate cannot renew authorization, the checkpoint remains paused and the app
shows an actionable error. Loading a normal queue replaces the checkpoint and
clears the authorization-pending state.

## Stream cache

Streamed tracks are kept in a Media3 `SimpleCache` in the app cache directory
(`crate-stream-cache`, 1 GB, least recently used first), so a dropped
connection does not stop playback while the current or next track is already
on disk. Downloaded (offline) tracks are local files and never use it; Android
may clear the cache when the device runs out of space.

- **What is downloaded.** On every queue or cursor change, and whenever the
  player becomes ready, the service downloads the current track and the next
  one, plus one more on an unmetered network (`NativeStreamPrefetchPlan`). One
  track at a time, on a background thread; a new plan cancels the download in
  progress. Tracks over 250 MB (long DJ mixes in FLAC) are streamed, not
  downloaded.
- **Only the prefetcher writes.** While a transcoded variant is being prepared
  the server answers its URL with the original file (or another variant), then
  with the variant once it is ready. `StableStreamResponseDataSource` refuses
  any response whose `X-Crate-Variant-Status` is not empty or `ready`, and any
  complete response whose length differs from the cached copy (which it drops),
  so two encodings are never spliced under one key. The player reads through
  the cache and streams what is missing without writing it.
- **Keys carry no credentials.** A key is the stream URL without `token`,
  `media_ticket` and similar rotating parameters (`NativeStreamCacheKeys`); the
  path names the track and `delivery` the quality. The cached audio itself is
  stored unencrypted in app-private storage.
