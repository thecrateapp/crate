---
title: "Making Crate usable from someone else's music player"
description: "An external player exposed assumptions Listen could hide. Crate needed a real OpenSubsonic contract for credentials, responses and playback state."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 23
related: [taking-playback-over-from-navidrome, letting-another-crate-into-the-catalogue]
tags: [How to dismantle Spotify, OpenSubsonic, playback, API, history]
sources:
  - docs/technical/opensubsonic.md
  - app/crate/subsonic/auth.py
  - app/crate/subsonic/protocol.py
  - app/crate/subsonic/routes.py
  - app/crate/subsonic/services/queues.py
  - app/tests/subsonic/test_contract_fixtures.py
  - app/tests/test_subsonic_queues.py
---

_Part 23. From the first Subsonic endpoints to the OpenSubsonic rebuild, April–September 2026._

A user could have playlists in Crate and still receive a successful, empty list in another player.
The `getPlaylists` handler authenticated the caller without ever reading their playlists. Before
the September rebuild, its successful path ended here:

```python source="app/crate/api/subsonic.py#L873-L878" commit="aca6d7bb6e023a3bf2a33b52d2228fc1e66cc946" "playlist"
def get_playlists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({"playlists": {"playlist": []}})
```

The client had no way to tell that result from an account with no playlists. We had added Subsonic
endpoints in April to expose authentication, the catalogue and streaming to other music players.
This endpoint had the expected name and a successful response, but left the user's data behind.

The replacement service read the same playlist repositories used by Crate. Its `target` normally
came from the authenticated account; supplying a username override required an administrator.
The list was then built from the returned records:

```python source="app/crate/subsonic/services/playlists.py#L56-L61" commit="180ce9188cad4ee860fefe2f1818623024145546"
    return [
        _playlist_fields(playlist, target)
        for playlist in get_open_subsonic_playlists(
            user_id=int(target["id"]), is_admin=target.get("role") == "admin"
        )
    ]
```

The service test supplies a private playlist named `Heavy rotation` from a mocked repository. It
expects a serialized `pl-12` entry with its name, owner, duration and `readonly: false`, and checks
that the repository received `user_id=7` with `is_admin=False`. The result now depends on the
account's data instead of an unconditional empty list.
[Playlist serialization test](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/tests/subsonic/test_playlists_service.py#L40-L69).

Creation and updates also use Crate's mutations and authenticated identity. An external player edits
the user's Crate playlists; it does not maintain a second collection solely for Subsonic.
[Playlist service](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/services/playlists.py).

Returning the records fixed that response. Making the integration usable also meant accepting the
credentials and parameters an independent client sent, responding in the format it expected, and
preserving its playback state when a track appeared twice.

## Give the client a separate credential

We could have required third-party players to implement Crate's native API. That would make the
server side convenient, but put the integration work on every client. A separate compatibility
server would add another service and another place to reconcile user state. Implementing an existing
music-server protocol inside Crate let those clients keep speaking the language they already used.

Subsonic defines more than names such as `getAlbum` and `stream`. Its API specifies authentication
parameters, a response envelope and XML as the default format, with JSON selected explicitly.
Its token scheme computes `md5(password + salt)` for a request. These are concrete interoperability
requirements, even where they differ from the API we would design for Listen today.
[Subsonic API specification](https://subsonic.org/pages/api.jsp).

Listen's login password was an awkward fit for this protocol. The old password branch verified it
against the user's password hash, while the token branch depended on a separate `subsonic_token`.
Those mechanisms did not have the same lifecycle.
[Previous authentication implementation](https://github.com/thecrateapp/crate/blob/aca6d7bb6e023a3bf2a33b52d2228fc1e66cc946/app/crate/api/subsonic.py#L103-L146).

The token calculation also requires the server to reproduce a digest from the original secret and a
new salt. A bcrypt login hash cannot supply that original secret. Changing the user's normal login
storage to accommodate a music-player protocol would be the wrong dependency.

We introduced a dedicated OpenSubsonic credential, created or rotated in Settings and displayed when
it is issued. A client that accepts an API key sends that credential as `apiKey`. A legacy client uses
its username and the dedicated credential in its password or token flow. Changing or revoking this
credential does not require changing the Listen login password.

The API-key path hashes the supplied value with SHA-256 for lookup. The legacy token path loads the
credential through Crate's secret store so it can calculate the protocol's salted digest. Rotation
replaces the stored credential and revokes the previous secret reference.
[Credential storage and rotation](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/db/repositories/subsonic_credentials.py),
[authentication paths](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/auth.py).

We also had to decide what to do with a request containing two authentication mechanisms. Silently
choosing whichever branch ran first would make behavior depend on implementation order. The new
handler rejects the ambiguity:

```python source="app/crate/subsonic/auth.py#L43-L53" commit="180ce9188cad4ee860fefe2f1818623024145546"
    has_legacy_mechanism = bool(present.intersection({"u", "p", "t", "s"}))
    if api_key is not None and has_legacy_mechanism:
        raise _auth_error(
            ErrorCode.CONFLICTING_AUTH_MECHANISMS,
            "Conflicting authentication mechanisms",
        )
    if password is not None and (token is not None or salt is not None):
        raise _auth_error(
            ErrorCode.CONFLICTING_AUTH_MECHANISMS,
            "Conflicting authentication mechanisms",
        )
```

Repeated credential parameters are rejected too. Repetition is valid elsewhere in the protocol,
though, so this could not be a blanket rule for every parameter.

Accepting `apiKey` did not mean Crate advertised the complete `apiKeyAuthentication` extension.
The compatibility profile advertised a narrower set: form POST, index-based queues, song lyrics
and top songs by artist ID.
[Compatibility profile and client matrix](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/docs/technical/opensubsonic.md).

## The same operation over GET, POST, XML and JSON

OpenSubsonic extends that contract. Two extensions were particularly useful here: URL-encoded form
POST requests and queues addressed by the position of the current item. The latter solves an
ordinary listening problem: a queue can contain the same song twice.
[HTTP form POST, version 1](https://opensubsonic.netlify.app/docs/extensions/formpost/),
[index-based queues, version 1](https://opensubsonic.netlify.app/docs/extensions/indexbasedqueue/).

A playlist request can carry several `songId` fields. The form POST test submits `song-1` and `song-2`
to a route with a mocked playlist service, then checks that both values reached the service in order.
Converting the request into a simple dictionary would discard a value before the service saw it.

The new parameter object preserves a tuple of values for each name and exposes both `first()` and
`get_all()`. Form POST support merges the form fields into the request's parameter view before a
handler runs. It does not rewrite the URL to include those fields. The shared collector knows when
that merge has happened, so it does not append the same form data a second time.
[Parameter collection](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/params.py),
[form POST route adapter](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/routes.py).

That small adapter applied across registered operations, including `.view` aliases. It avoided a
situation where browsing accepted form POST but saving a playlist unexpectedly required GET. Tests
exercise both forms, repeated values, empty fields and non-ASCII text. They also check that form
credentials are not copied into the request URL.
[Form POST tests](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/tests/subsonic/test_form_post.py).

Responses needed the same consistency. The old helper always produced JSON. The new renderer builds
one envelope, then selects the requested representation:

```python source="app/crate/subsonic/protocol.py#L42-L50" commit="180ce9188cad4ee860fefe2f1818623024145546"
    envelope = response_envelope(data, error)
    if response_format == "json":
        return JSONResponse(content=envelope)
    if response_format != "xml":
        raise ValueError("response_format must be 'json' or 'xml'")
    return Response(
        content=_render_xml(envelope["subsonic-response"]),
        media_type="application/xml",
    )
```

XML is the default argument to that renderer. Lists, scalar attributes and the namespace are handled
centrally. A protocol failure is represented by `status="failed"` and an error code inside the
Subsonic envelope, normally with HTTP 200. A client expecting that envelope cannot use an unrelated
FastAPI error body just because both describe a missing track. Transport rejection is separate: the
form adapter can return HTTP 400 for malformed input or 413 for an oversized body before the operation
runs.

This also changes monitoring. Counting HTTP 500 responses will miss a protocol failure carried by
HTTP 200. Crate records bounded protocol error categories separately. Media delivery remains a
separate case: a stream or download is a binary HTTP response, with its own status and range behavior.

The rebuild added immutable upstream contract fixtures, golden responses and an isolated HTTP smoke
stack with PostgreSQL, Redis and disposable library data. The fixture checks distinguish an enhanced
OpenSubsonic XML response from the older Subsonic XSD: an extra attribute cannot simply be waved
through as if the old schema had defined it.
[Contract fixture tests](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/tests/subsonic/test_contract_fixtures.py).

Crate retained the `/rest` entry point and `.view` aliases. Behind them, the new implementation split
request parsing, authentication, response rendering and domain services into separate modules.
That let a playlist handler concern itself with who could see or modify a playlist, while the shared
protocol layer handled how the request and response travelled over HTTP.

![A third-party player sends GET or form POST requests through Crate's shared protocol layer to existing catalogue, playlist and playback services. A saved queue keeps both occurrences of a repeated track.](/blog/making-crate-usable-from-someone-elses-music-player/protocol-boundary.svg)

The HTTP harness exercises authentication, catalogue browsing, artwork, search, playlist mutations,
preferences, scrobbling, saved queues, byte-range requests and advertised extensions. These are
repeatable requests against a running server. They do not prove that every independent player has
been exercised successfully.

The engine switch made the new router selectable without removing the legacy adapter. The development
and isolated smoke-stack Compose files selected `v1`; without the environment setting, router
selection still defaulted to `legacy`. This code change was not a production cutover. Selecting
`legacy` also did not undo credential migrations or restore the untouched April module: the legacy
adapter shared parts of the new authentication and transport code.
[Engine selection](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/capabilities.py#L17-L26).

A stream or download takes a different response path from the playlist list. Local streams use
Crate's playback service, and global catalogue IDs go through federation playback. The adapter maps
supported format and bitrate requests to the existing delivery policies; it does not promise arbitrary
transcodes. Downloads deliver the original media. A remote catalogue identifier never becomes a guessed
local filesystem path.
[Media service](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/services/media.py).

## Restore the second occurrence of a track

If a queue contains `("1", "2", "1")` and the second occurrence of track 1 is playing, saving
`current=1` loses that distinction. The ID-based path selects the first matching item. With
`currentIndex=2`, the index-based operation can preserve the occurrence the client selected.
The queue regression test uses that sequence. The service requires the index and checks its bounds
before resolving the track IDs:

```python source="app/crate/subsonic/services/queues.py#L142-L152" commit="180ce9188cad4ee860fefe2f1818623024145546" "current_index"
    current_index: int | None = None
    canonical_current: str | None = None
    if by_index:
        if not params.contains("currentIndex"):
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER,
                "Required parameter 'currentIndex' is missing",
            )
        current_index = _parse_nonnegative_int(params, "currentIndex")
        if current_index >= len(ids):
            raise _invalid_parameter("currentIndex")
```

Resolving those IDs can use a cache without deduplicating the queue. The test supplies only two
resolved tracks, while the saved queue still contains all three positions. It also submits a
position of `999999` milliseconds for a track lasting 180 seconds and expects `180000` to be stored.
The selected track's duration bounds the saved position when that duration is known.

Restoration handles another change: a track might no longer be available. The response omits those
entries and adjusts the index while leaving the stored snapshot alone. If the saved occurrence still
exists, it remains current in the filtered queue. If it is missing, the service picks the next
available original position, or the last entry when there is no later one, and resets the playback
position to zero.

We reused the per-user playback-state repository with an `opensubsonic` device identifier. Saving
this queue does not advertise a live Connect device: the write uses `touch_presence=False` and stores
a paused snapshot. The last committed queue update wins, so two external clients saving concurrently
do not receive independent named queues. A second client can replace the first client's saved queue.
[Queue implementation](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/crate/subsonic/services/queues.py),
[duplicate, position and restoration tests](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/app/tests/test_subsonic_queues.py).

An external player that asks for playlists now gets the user's playlists, which was the bug this
chapter started with, and its saved queue survives tracks that disappear. What we cannot yet say is
how Feishin, Symfonium and Subtracks behave against it. They are still **Pending RC** in the client
matrix. The fixtures and HTTP harness make a disagreement reproducible, but each client still needs
its own recorded session: client build, OS or device, outcome and redacted evidence, including
whether browsing, seeking and restoring a queue work.
[Client acceptance checks](https://github.com/thecrateapp/crate/blob/180ce9188cad4ee860fefe2f1818623024145546/docs/technical/opensubsonic.md#release-candidate-client-smoke-matrix).
