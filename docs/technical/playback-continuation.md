# Playback continuation

Infinite album/playlist playback and radio share the shaped radio session engine.
The original source remains attached to play events; Music Paths play as finite
queues and do not claim a playlist ID. Seeded radios use significant-listen
history to rotate songs across sessions without changing musical weights or drift.

## Indexed batches

- `POST /api/radio/start` accepts an optional client-generated UUID `session_id`,
  a bounded `count` and `buffer_refs` in playback order. Its first batch is zero.
- `POST /api/radio/next` requires a UUID `session_id` and accepts an optional
  `batch_index`. UUIDs are normalized before session lookup;
  malformed IDs receive HTTP 422. Existing sessions started without an index
  begin continuation at batch one.
- Indexed responses preserve tracks and add `status` and
  `batch_index`. Status is `ok`, `retryable_empty`, `exhausted` or `auth_required`.
- A transport error is an error, not an empty success. Retrying uses the same
  index; confirmed empty or deduplicated batches advance the cursor and retry
  with backoff. Successful replays never rewind a client's next-batch cursor.
  A `retryable_empty` response carries an authoritative cursor and can resync it
  backwards after an out-of-order request or lease recovery.
- Session progress and the replayable batch commit atomically in Redis under a
  per-session lock. Every writer, including feedback, legacy next and deletion,
  watches the lock token so it cannot commit after losing its lease.
- Lease contention or loss returns `retryable_empty` with the committed session
  cursor, or replays the requested batch if it already committed.
  A start with no committed session returns cursor `-1`, so the next request
  still starts at batch zero. Legacy continuation, feedback and deletion return
  HTTP 409 with `Retry-After: 1`. Unrelated failures remain errors. Local feedback
  is persisted after releasing the session lock.
- Only the two latest indexed batches are retained. Pruning commits in the same
  Redis transaction as progress. Retrying a pruned start for a live, owned
  session returns its authoritative cursor without regenerating batch zero.
  Deletion removes all cached batches atomically and preserves the expiry marker.
- Sessions and batch payloads have a 24-hour TTL. A 48-hour marker prevents a
  recently expired or discarded session from being silently recreated at batch
  zero. A missing continuation session returns `exhausted`.
- Ownership is checked before replaying a cached batch. Proxy identities must
  resolve to a real user ID. Private playlist access is checked at session start.
- Session deletion removes its current and previous retained batch by cursor,
  within the same fenced transaction, without scanning Redis. Legacy global
  radio responses report `status: exhausted` consistently with `exhausted: true`.

Continuation uses the session UUID and batch cursor, without a numeric session
revision. Native continuation rejects the removed `revision` field with HTTP
422, so native clients must be updated alongside the server. The legacy
`/api/radio/next` schema continues ignoring extra fields. String queue revisions,
configuration generations and native event sequences remain separate guards.

The buffer is excluded by canonical/local identity. Its final track blends into
the existing transition target using the profile's weight, preserving likes and
the original seed as the musical anchor. Buffered artists and titles also join
the repetition controls.
Infinite also works with shuffle; repeat-one/all keeps priority.
Local and global buffer metadata is loaded with one indexed batch query.
Native continuation filters known, duplicate and explicitly unplayable tracks
before deriving status, without changing the replayable batch. An empty filtered
batch is retryable unless the source is exhausted or authorization is required.
Radio start/next preserve nullable track fields for legacy parsers; station
responses continue omitting absent optional metadata.

## Seven-day radio rotation

`CRATE_RADIO_ROTATION_ENABLED` defaults to `true`. Set it to `false` and recreate
the API container to restore legacy retrieval and ranking without rebuilding
the image. The same setting is forwarded by the production and development
Compose configurations.

A play is significant when completed, or after `min(30 seconds, 50% of a positive
track duration)`; unknown duration uses 30 seconds. One batched read uses the
listener's last seven days of raw events, including the UTC window boundaries.
Local IDs, entity IDs, global IDs and song variants resolve to the shared song
identity. Brief playback, generation and prefetch do not create cooldowns.
The existing event ingestion and projections are unchanged.

The radio retains its seed artist/track context. When the best candidate is cooled,
fresh songs within 0.05 of its existing musical score are chosen with the session's
deterministic RNG. A fresh best candidate keeps the existing minimum-score choice;
unrelated listening history does not introduce random variation.
The penalty belongs to songs, not whole artists. Recently heard songs remain
eligible when there are no comparable fresh alternatives, including small or
fully cooled catalogs. Discovery mode and Music Paths retain their policies.

The retrieval counts eligible song families after active-buffer and dislike
exclusions. It can expand once within the seed's artist/genre neighborhood;
it never fills a short rotating seeded pool with an unrelated global Bliss
fallback. Recent history starts with a bounded 420-row pool and doubled
per-artist SQL caps. A diverse shortlist retains fresh options and cooled
quality anchors before sequential scoring. Catalog-only global radios expand
within their source artist/album, bounded to 5,000 tracks, before recovering
recently heard songs.

The session retains the latest 500 delivered canonical song families as a cooled
layer, including songs skipped before a significant listen. Re-delivery promotes
the family within that bounded ledger; replaying a committed batch does not change
it. Artist counts accumulate across refills. Significant seven-day history remains
independent of delivery, and both sources prefer comparable fresh alternatives.

Explicit `buffer_refs=[]` means the client knows its buffer is empty. Supplied
buffer tracks and song families are hard exclusions alongside the original seed;
updating the buffer preserves delivered-song memory and artist counts. Omitted/null
buffers retain conservative progress. Historical ID parameters are capped at 50,
while Python checks retain the complete active-buffer and seed exclusions. Candidate
expansion adds only bounded exclusions from its retrieved pool.

The global catalog cursor advances across refills. Once its source is fully loaded,
a known released buffer permits cooled fallback without rewinding that cursor.
If every available family is blocked by the active buffer or explicit exclusions,
the empty result is exhausted rather than an endless retryable response.

The sanitized [checkpoint comparison](evidence/radio/rotation-review.md)
contains Citizen/Concubine lists before and after simulated completed listens.
The historical checkpoint records buffer lookup and generation measurements.
Current endpoint and history budgets are rechecked against the approximately
138K-track catalog before closing this stack. Album ownership equivalence and
the shared availability filters are documented in the
[retrieval check](evidence/radio/album-ownership.md).

## Transition fit

`CRATE_TRANSITION_FIT_ENABLED` defaults to `true`. Seeded radio and Music Paths then
replace the coarse BPM, key and energy penalties with the Smart Mix transition fit
between the track that plays last and each candidate: edge loudness, brightness,
silence between tracks, tempo and key, weighted for beatmatch or for a smooth entry
according to genre and rhythm evidence (see
[Smart Mix operations](smart-mix-operations.md)). Candidate queries load the profile
edges in the same statement; a context track restored from the client buffer costs
at most one indexed lookup per batch. A candidate without a current profile gets a
neutral seam; when the playing track has no profile, every candidate keeps the coarse
penalties. Set it to `false` and recreate the API container to restore the previous
ranking. Measurements: [radio transition fit](evidence/radio/transition-fit.md).

## Playback lifecycle

The JavaScript runtime owns foreground refill, including EOF recovery, bounded
request deadlines, retries independent of progress ticks, and online/visibility
wakeups. Explicit pause, stop and source replacement invalidate pending work.
No response from an old generation can append or resume the new queue.
Stream recovery suspends refill, installs fresh media URLs for the current queue
and restores readiness only for its own preparation generation. Queue changes
while URLs resolve are prepared again before loading the engine.
Refill waits until a newly selected queue has finished media preparation and
has been installed in its playback engine, so the previous queue cannot supply
the new seed context.

EOF recovery stops waiting after five transport failures or 60 seconds under
JavaScript ownership. It clears buffering, shows one translated notice and waits
for an explicit Play or track-selection gesture before retrying. Selecting an
earlier track resumes prefetch without skipping that track. Prefetch failures do not interrupt
a track already playing. Online and visibility wakeups respect the retry backoff;
authorization and exhausted results remain terminal. A confirmed append/advance
ends the EOF wait before cursor publication, whose acknowledgement is bounded to
10 seconds and cannot undo the incorporated batch.

Android takes background ownership only after valid native continuation
configuration has been installed. It schedules its own retries and checks queue
revision and configuration generation before applying any result. Foreground
JavaScript adopts native additions and the server cursor before requesting more.
An existing JavaScript EOF deadline is suspended while native owns continuation.
On return, adoption and a bounded native-state read confirm whether playback
advanced before JavaScript can fetch or advance again. A confirmed new active
track retires the old wait; otherwise foreground EOF recovery remains available.
Toggling Infinite/repeat updates configuration without reloading the track.
Reinstalling the same token/session without an authoritative cursor reset invalidates
pending requests while retaining terminal results, backoff and the original ENDED deadline. An app-resume event
only renews authorization when it has expired. Finite EOF releases audio focus
while keeping the Media3 service and controls; only a continuation deadline stops it.
Foreground native appends reserve queue positions until their ACK; a failure
removes only those reservations. A confirmed append advances its cursor even
if playback was paused in the meantime, without resuming playback.

Native continuation uses a session-bound, expiring continuation token. A rejected
token clears configuration and allows one authenticated reissue. Logout also
invalidates outstanding token responses. Browser credentials are never sent to
Cast receivers.

Custom Cast appends synchronize the receiver before reporting progress locally.
Queued mutations and navigation recheck source/session/lifecycle guards before
sending commands. Explicit remote `PAUSED` is distinct from EOF. The optional protocol-v1
`mediaFinished` signal carries actual EOF even when the last progress reading
is late. Intermediate `IDLE` events preserve playback intent; old receivers use
a two-second EOF margin only when they omit `mediaFinished`. Cast mutation ACKs
expire after 10 seconds and full append preparation after 30 seconds. An uncertain
append requires a real receiver snapshot before retrying, preventing duplicates
after a lost ACK. When cached web items are missing after a failed command, the
sender requests CAF media status before reconciling; absent receiver items still
prevent a blind retry. Confirmed commands do not mark the queue uncertain.
Late acknowledgements cannot commit a newer operation.

## Validation and remaining review

Automated coverage includes duplicate/concurrent requests, replay after lost
responses, session ownership and expiry, Redis lease loss before/during commit,
EOF during fetch/append, empty and deduplicated batches, reconnect, pause, source
replacement, native handoff, preference changes, and queued Cast cancellation.
Android service lifecycle tests run under Robolectric against the real service,
including unchanged configuration, terminal state, retry scheduling and finite EOF.
The lease recovery contracts run against Redis 7 through Testcontainers by
default. CI supplies a dedicated Redis service. To use another **dedicated
disposable** Redis:

```bash
cd app
CRATE_TEST_RADIO_REDIS_URL=redis://127.0.0.1:16379/0 \
  ../.venv/bin/python -m pytest tests/test_radio_lease_recovery.py -q
```

Each test uses a unique session UUID and removes only that session's keys; the
fixture does not flush the database. Never point it at application Redis.

Before release, review on the Xiaomi with crossfade off/on, screen off, a brief
network outage, slow EOF refill and pause during a request; verify automatic
append on a physical Cast receiver and the same EOF cases in web/Tauri.
Representative-catalog measurements must identify the complete stack, installed
indexes, HTTP boundary, data-query counts and total SQL round trips. Lost Cast ACK
reconciliation has automated coverage; physical receiver QA remains necessary.
