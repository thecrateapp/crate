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
production library, the API answered in 200 to 800 milliseconds on average. We were aiming for under 100 ms at the
95th percentile.

An artist page could fire more than 4,400 queries. We addressed those N+1 lookups by batching them with
`ANY(:ids)`, a rule we now enforce across the project. But batching still left Python rebuilding the busiest
screens every time someone opened them, on a home server that also had audio analysis and transcoding to do.

A home screen rarely changes between two taps. We moved that work out of the request and kept the result
ready for the next reader.

## Build the screen in the background

We split building a screen from serving it. When something changes, a background process rebuilds the
affected screen and stores it. Requests read that stored copy.

![The write path turns changes into events that a projector turns into snapshots; the read path serves those snapshots from Go and falls back to FastAPI.](/blog/reads-from-snapshots/hot-read-path.svg)

On the write side, a change becomes an event, the event reaches a projector, and the projector rewrites a
snapshot. On the read side, a small Go service reads one snapshot row and returns it. A request that finds
a usable snapshot can return it while the projector is still working on the next version.

## Writes become events, in the same transaction

Committing a change and publishing its event as separate operations leaves a failure between them: the
process can crash after the commit, leaving the projector unaware of the change. We use an outbox to keep
them together. The code that writes the change also inserts a row into `domain_event_outbox`, in the same
transaction. Either both exist or neither does.

A relay drains the outbox. It claims rows with `FOR UPDATE SKIP LOCKED`, so concurrent relays can claim
different rows, and pushes them to a Redis stream called `crate:domain_events`. A small Lua script remembers
what it already published for seven days and suppresses duplicate pushes during that window.

## A projector rebuilds only what changed

The projector reads that stream every five seconds, up to 200 events at a time, and decides which screens each
event affects. A play event touches one user's "recently played". A like touches that user's home. New listening
aggregates touch both the user's stats and the instance's:

```python source="app/crate/projector.py#L262-L276" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "actions.add"
if event_type == "user.play_event.recorded":
    user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
    if user_id is not None:
        actions.add(("recent-user", user_id))
elif scope == "home:discovery":
    user_id = _coerce_int(event.get("subject_key"))
    if user_id is not None:
        actions.add(("home-user", user_id))
elif event_type in _HOME_EVENT_TYPES:
    user_id = _coerce_int(payload.get("user_id") or event.get("subject_key"))
    if user_id is not None:
        actions.add(("home-user", user_id))
        if event_type == "user.listening_aggregates.updated":
            actions.add(("stats-user", user_id))
            actions.add(("stats-instance", None))
```

We collect actions in a set, so fifty likes from one user in the same batch rebuild that home screen once.
The projector only acknowledges events whose actions all succeeded; an event that keeps failing goes to a dead-letter
stream after five attempts instead of blocking the rest.

The result lands in `ui_snapshots`: one row per screen and subject, with the JSON payload, a version that goes up
on every write, when it was built and when it should be considered stale.

## A small Go service serves the result

We gave the Go read plane a budget of 128 MB of memory and a quarter of a CPU. For a hot route it
authenticates the request, reads one snapshot row and answers. A two-second in-process cache of
1,000 entries absorbs bursts, like several devices in the same household opening the app at once.

If the snapshot is missing, the read plane hands the request to FastAPI. Only when that isn't possible does it
answer with a 404 or a 503 itself:

```go source="app/readplane/internal/routes/server.go#L424-L439" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "s.tryFallback(w, r)"
row, err := s.snapshots.Get(r.Context(), "home:discovery", strconv.FormatInt(user.ID, 10))
if err != nil {
	if s.tryFallback(w, r) {
		return
	}
	status := http.StatusServiceUnavailable
	detail := "Home discovery snapshot unavailable"
	if errors.Is(err, snapshots.ErrNotFound) {
		status = http.StatusNotFound
		detail = "Home discovery snapshot not found"
	}
	httpx.MarkReadplane(w, "miss")
	httpx.WriteError(w, status, detail)
	return
}
httpx.MarkReadplane(w, "hit")
```

The `X-Crate-Readplane` response header identifies the path: `hit`, `miss` or `fallback`. That lets us check
whether we're debugging a served snapshot or a request that went back to Python:

```sh title="Check which path served the home screen"
curl -s -o /dev/null -D - "https://your-crate-server/api/me/home/discovery" \
  -H "Authorization: Bearer $TOKEN" | grep -i x-crate-readplane
```

The fallback itself sits behind a circuit breaker: after five
consecutive failures it stops forwarding for ten seconds and answers `503` with `Retry-After: 1`, so a struggling
API isn't buried under retries.

## How stale is too stale

Moving the work into the background means a request can see an older version of a screen. We give each
snapshot a freshness deadline and a second, longer deadline after which we stop serving it. The read plane
checks both here:

```go source="app/readplane/internal/snapshots/store.go#L327-L334" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "maxAge" "staleMaxAge"
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

The app also needs to know when a snapshot changes. Every snapshot write publishes a message on a Redis
channel, with just the scope, the subject and the new version. The read plane relays it over Server-Sent Events.
For the home screen it goes one step further: it re-reads the new snapshot and pushes the whole payload, so the
app updates without asking again.

## What it cost

Reads are eventually consistent. A change can wait up to five seconds for the next projector poll, and the
read plane has its two-second cache. A backlog or a failed rebuild can delay it further. A `hit` only tells
us that we served a snapshot; we monitor outbox backlog, stream lag and snapshot age separately to see how
far behind it is.

We now maintain two implementations of these reads: Go serves the snapshots and Python still knows how to
build them. Our contract smoke test, `make readplane-contract-smoke`, compares both responses to catch drift.
A new hot route touches five places: the Go router, a routes manifest, Traefik labels, the nginx config and
Python guard tests. Those all need to agree on which service owns the route.

We kept one exception for a user's first visit. If their home screen has never been built, FastAPI builds
it inside the request once. Later requests can use the stored version.

We haven't published a before-and-after p95 yet. `make readplane-benchmark` can measure the two paths on the
same deployment; that comparison needs to use the current library. It has grown to roughly 138,000 tracks
and 4 TB since this work started. A home request with a usable snapshot still reads one stored row, while
the work of rebuilding that row runs in the background.

## Read the code

The routing and fallback live in `app/readplane/internal/routes/server.go`, the freshness rule in
`internal/snapshots/store.go`, and the event-to-screen mapping in `app/crate/projector.py`. The outbox and the
Redis relay are in `app/crate/db/domain_events.py`.
