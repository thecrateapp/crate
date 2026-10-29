# Playback continuation

Infinite album/playlist playback and radio share the shaped radio session engine.
The original source remains attached to play events; Music Paths play as finite
queues and do not claim a playlist ID. Recommendation weights and seven-day
cross-session rotation are outside this change.

## Indexed batches

- `POST /api/radio/start` accepts an optional client-generated UUID `session_id`,
  a bounded `count` and `buffer_refs` in playback order. Its first batch is zero.
- `POST /api/radio/next` accepts an optional `batch_index` and `revision`.
  Existing sessions started without an index begin continuation at batch one.
- Indexed responses preserve tracks and add `status`, `revision` and
  `batch_index`. Status is `ok`, `retryable_empty`, `exhausted` or `auth_required`.
- A transport error is an error, not an empty success. Retrying uses the same
  index; confirmed empty or deduplicated batches advance the cursor and retry
  with backoff. An out-of-order request returns the authoritative cursor.
- Session progress and the replayable batch commit atomically in Redis under a
  per-session lock. Every writer, including feedback, legacy next and deletion,
  watches the lock token so it cannot commit after losing its lease.
- Lease contention or loss returns `retryable_empty` with the committed session
  cursor and revision, or replays the requested batch if it already committed.
  A start with no committed session returns cursor `-1`, so the next request
  still starts at batch zero. Legacy continuation, feedback and deletion return
  HTTP 409 with `Retry-After: 1`. Unrelated failures remain errors. Local feedback
  is persisted after releasing the session lock.
- Sessions and batch payloads have a 24-hour TTL. A 48-hour marker prevents a
  recently expired or discarded session from being silently recreated at batch
  zero. A missing continuation session returns `exhausted`.
- Ownership is checked before replaying a cached batch. Proxy identities must
  resolve to a real user ID. Private playlist access is checked at session start.

The buffer is excluded by canonical/local identity. Its final track supplies
local transition context, while the original seed remains the musical anchor.
Infinite also works with shuffle; repeat-one/all keeps priority.
Local buffer metadata is loaded with one indexed batch query.

## Playback lifecycle

The JavaScript runtime owns foreground refill, including EOF recovery, bounded
request deadlines, retries independent of progress ticks, and online/visibility
wakeups. Explicit pause, stop and source replacement invalidate pending work.
No response from an old generation can append or resume the new queue.
Refill waits until a newly selected queue has finished media preparation and
has been installed in its playback engine, so the previous queue cannot supply
the new seed context.

Android takes background ownership only after valid native continuation
configuration has been installed. It schedules its own retries and checks queue
revision and configuration generation before applying any result. Foreground
JavaScript adopts native additions and the server cursor before requesting more.
Toggling Infinite/repeat updates configuration without reloading the track.
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
is late.

## Validation and remaining review

Automated coverage includes duplicate/concurrent requests, replay after lost
responses, session ownership and expiry, Redis lease loss before/during commit,
EOF during fetch/append, empty and deduplicated batches, reconnect, pause, source
replacement, native handoff, preference changes, and queued Cast cancellation.
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
Representative-catalog latency measurements are still pending. Lost Cast ACK
reconciliation remains outside this PR, as specified in the implementation plan.
