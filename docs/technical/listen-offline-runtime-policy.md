# Listen offline runtime policy

Offline media is partitioned by Crate server and user. Metadata remains a
small stable façade in `offline.ts`, with focused adapters for metadata
storage, browser Cache API media, native filesystem verification and bounded
transfer scheduling.

## Transfer policy

- Maximum concurrent downloads: two.
- The storage budget is rechecked immediately before each track transfer.
- No new transfer starts while the document is hidden, the browser reports
  offline, Data Saver is active, or the effective connection is 2G/slow-2G.
- Backgrounding aborts scheduling. Completed transfers remain indexed and a
  foreground/online event resumes the manifest from its current state.
- Cancellation never deletes completed assets and never schedules the
  remaining queue.
- Progress updates remain visible in React, while durable snapshot writes are
  coalesced to at most one per 100 ms. Terminal state flushes immediately.

## Native integrity

Hydration verifies existing files through one bounded native bridge call
instead of one Capacitor roundtrip per track. Batches are capped at 500 paths,
must remain inside the platform data directory and compare expected sizes when
known. Missing or corrupt files are removed from the index atomically; a size
mismatch also deletes the corrupt file.

Older native shells that do not yet expose `CrateOfflineIntegrity` use the
per-file Capacitor fallback. This supports backend-first/client-second rollout
without making existing offline libraries unreadable.

## Browser behavior

Web/PWA media remains in the profile-specific Cache API namespace. Canonical
entity and legacy storage aliases are checked without a network fetch. A new
response is cached only after status and known content length pass integrity
validation.
