---
title: "Serving hot screens from snapshots, not queries"
description: "Crate's busiest screens used to be built in Python on every request. Now a projector builds them once and a small Go service serves the result."
date: 2026-11-10
tags: [read plane, Go, PostgreSQL, Redis]
sources:
  - app/readplane/internal/routes/server.go
  - app/readplane/internal/snapshots/store.go
  - app/crate/projector.py
  - app/crate/db/domain_events.py
  - docs/technical/02-backend-api-and-data.md
---

Open Listen and the first thing you see is the home screen: recently played, new albums, mixes, artists you
follow. Every one of those rows is a database question. In early 2026, with about 48,000 tracks in the
production library, the API answered in 200 to 800 milliseconds on average. The target was under 100 ms at the
95th percentile.

Part of that was the usual suspect, N+1 queries: an artist page could fire more than 4,400 of them. The cure for
that kind is known, and it's now a project rule: batch lookups with `ANY(:ids)`, never loop. The rest was
structural: the busiest screens were rebuilt from scratch every time someone asked for them, by Python, on a
home server that is also analysing audio and transcoding streams.

A home screen rarely changes between two taps, so Crate stopped computing it on request.

## The shape of the fix

Crate now keeps the answer ready. When something changes, a background process rebuilds the affected screen once
and stores it, and requests read the stored copy.

![The write path turns changes into events that a projector turns into snapshots; the read path serves those snapshots from Go and falls back to FastAPI.](/blog/reads-from-snapshots/hot-read-path.svg)

The two paths never wait for each other. On the write side, a change becomes an event, the event reaches a
projector, and the projector rewrites a snapshot. On the read side, a small Go service reads one snapshot row and
returns it.

## Writes become events, in the same transaction

The classic way to lose an event is to commit the change and then publish the event, and crash in between. Crate
uses an outbox instead: the code that writes the change also inserts a row into `domain_event_outbox`, in the
same transaction. Either both exist or neither does.

A relay drains the outbox. It claims rows with `FOR UPDATE SKIP LOCKED`, so two relays never publish the same row,
and pushes them to a Redis stream called `crate:domain_events`. The push is a small Lua script that remembers
what it already published for seven days, which makes a retry harmless.

## A projector rebuilds only what changed

The projector reads that stream every five seconds, up to 200 events at a time, and decides which screens each
event affects. A play event touches one user's "recently played". A like touches that user's home. New listening
aggregates touch both the user's stats and the instance's:

```python
if event_type == "user.play_event.recorded":
    user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
    if user_id is not None:
        actions.add(("recent-user", user_id))
elif event_type in _HOME_EVENT_TYPES:
    user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
    if user_id is not None:
        actions.add(("home-user", user_id))
        if event_type == "user.listening_aggregates.updated":
            actions.add(("stats-user", user_id))
            actions.add(("stats-instance", None))
```

Actions are a set, so a burst of fifty likes from one user rebuilds that home screen once. The projector only
acknowledges events whose actions all succeeded; an event that keeps failing goes to a dead-letter
stream after five attempts instead of blocking the rest.

The result lands in `ui_snapshots`: one row per screen and subject, with the JSON payload, a version that goes up
on every write, when it was built and when it should be considered stale.

## A small Go service serves the result

The read plane is a Go service with a deliberately tiny budget: 128 MB of memory and a quarter of a CPU. For a
hot route it authenticates the request, reads one snapshot row, and answers. A two-second in-process cache of
1,000 entries absorbs bursts, like several devices in the same household opening the app at once.

If the snapshot is missing, the read plane hands the request to FastAPI:

```go
row, err := s.snapshots.Get(r.Context(), "home:discovery", strconv.FormatInt(user.ID, 10))
if err != nil {
	if s.tryFallback(w, r) {
		return
	}
	// no fallback available: 404 if missing, 503 if the store is down
}
httpx.MarkReadplane(w, "hit")
```

Every response says what happened in an `X-Crate-Readplane` header: `hit`, `miss` or `fallback`. That header is
the first thing to check when a screen looks wrong. The fallback itself sits behind a circuit breaker: after five
consecutive failures it stops forwarding for ten seconds and answers `503` with `Retry-After: 1`, so a struggling
API isn't buried under retries.

## How stale is too stale

A snapshot that is a few minutes old is usually fine. One that is hours old usually isn't. The read plane makes
that call in one small function:

```go
stale = now.Sub(builtAt) > maxAge
if staleAfter != nil && !staleAfter.IsZero() && !staleAfter.After(now) {
	stale = true
}
if !stale {
	return false, true
}
return true, now.Sub(builtAt) <= staleMaxAge
```

By default a snapshot is fresh for ten minutes and still served, marked stale, for up to an hour. Stats screens
are more forgiving: five minutes fresh, a day usable. Past that, the snapshot counts as missing and the request
falls back.

## Telling the screen that it changed

The app also needs to know when a snapshot changes. Every snapshot write publishes a tiny message on a Redis
channel, with just the scope, the subject and the new version. The read plane relays it over Server-Sent Events.
For the home screen it goes one step further: it re-reads the new snapshot and pushes the whole payload, so the
app updates without asking again.

## What it cost

Reads are eventually consistent. Between a change and the rebuilt snapshot there are up to five seconds of
projector interval, plus the two-second cache. The internal docs say it plainly: a read plane hit is not a
claim of fresh data. Outbox backlog, stream lag and snapshot age are monitored separately for that reason.

The same reads now exist twice: Go serves them and Python still knows how to build them. A contract smoke test,
`make readplane-contract-smoke`, compares both responses so they can't drift apart. Adding a hot route touches
five places (the Go router, a routes manifest, Traefik labels, the nginx config and Python guard tests). That friction
is deliberate: hot routes should be few.

There is one exception to the no-building-in-a-request rule. When a user's home screen has never been built,
FastAPI builds it inside the request, once, so the first visit doesn't show an empty home.

We haven't published a before-and-after p95 yet. `make readplane-benchmark` prints one for any deployment, and it
belongs in a future post, measured on the current library rather than the old one. Production has grown to
roughly 138,000 tracks and 4 TB since this started, and the home screen still reads one row.

## Read the code

The routing and fallback live in `app/readplane/internal/routes/server.go`, the freshness rule in
`internal/snapshots/store.go`, and the event-to-screen mapping in `app/crate/projector.py`. The outbox and the
Redis relay are in `app/crate/db/domain_events.py`.
