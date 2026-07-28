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
