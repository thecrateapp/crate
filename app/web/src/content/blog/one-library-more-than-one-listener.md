---
title: "One library, more than one listener"
description: "Login could distinguish Crate's users before the library could. We added personal collections, ownership checks and sessions we could revoke."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 6
related: [taking-playback-over-from-navidrome, filesystem-to-indexed-catalogue, reads-from-snapshots]
tags: [How to dismantle Spotify, authentication, PostgreSQL, history]
sources:
  - docs/technical/07-auth-users-social-and-sessions.md
  - app/crate/api/auth.py
  - app/crate/api/me.py
  - app/crate/api/playlists.py
  - app/crate/db/queries/user_library_library.py
  - app/crate/db/repositories/user_library_mutations.py
  - app/crate/db/repositories/auth_sessions.py
  - app/tests/test_user_library_queries.py
  - app/tests/test_playlist_access.py
---

_Part 6. Personal libraries and account sessions, March–April 2026._

Two people could log in to the same Crate, open their playlists and see the same list.

Creating a playlist saved its owner's `user_id`, but listing playlists called `get_playlists()` without
passing that ID. The query returned everything. The application knew who was asking and then discarded
the distinction when it read the data.
[The original playlist routes](https://github.com/thecrateapp/crate/blob/18987bb6bcd7e95a9538fab454f53a75be1b92b2/app/crate/api/playlists.py#L79-L109).

That gap ran beyond playlists. The catalogue described the music on the server. It had artists, albums
and playable tracks, but it could not answer which artists one person followed or which albums they
wanted to keep in their Library. Giving everyone a different login did not create those relationships.

The [catalogue chapter](/blog/filesystem-to-indexed-catalogue) moved browsing out of directory walks and
into PostgreSQL. It answered questions such as which albums an artist had and where their audio files
lived. Those answers were useful to every listener.

A saved album needed to belong to a listener without giving that listener ownership of the music
files. Two people could save the same record. Removing it from one person's Library should leave the
other person's selection intact, and both should still be able to browse the album.

Navidrome makes the same distinction at the product level: its multi-user support gives each account
separate play counts, playlists and favourites. That is a useful comparison for what a shared music
server needs to keep personal.
[Navidrome's feature overview](https://www.navidrome.org/docs/overview/#features).

Crate needed those relationships in its own database as Listen took over playback. Continuing to use
Navidrome for personal state would have left Listen coordinating two sets of users and media
identifiers. We were already removing that dependency from the
[playback path](/blog/taking-playback-over-from-navidrome).

The example uses two ordinary accounts: listener A is user `7`, listener B is user `12`, and the
shared album is `42`. These are illustrative IDs, also used in the diagram below. Neither
account has saved the album yet. Both have a valid Crate login; neither is an administrator.

## Same request body, different rows

A and B send the same body, `{"album_id": 42}`, to `POST /api/me/albums`. The endpoint gets the account
ID from authentication, so A's request calls `save_album(7, 42)` and B's calls `save_album(12, 42)`.
The browser chooses the album. Supplying another account ID in the request cannot change the ID this
route passes to the database:

```python source="app/crate/api/me.py#L78-L83" commit="fb7b3ffaa965579bac8f6b93460ce2d5f0764c27" "save_album"
@router.post("/albums")
def save_album_endpoint(request: Request, body: SaveAlbumRequest):
    user = _require_auth(request)
    from crate.db.user_library import save_album
    added = save_album(user["id"], body.album_id)
    return {"ok": True, "added": added}
```

The first personal-library schema added four tables: artist follows, saved albums, liked tracks and
play history. They referred to the shared catalogue in different ways. Saved albums used the album's
database ID; artist follows used names, and liked tracks used paths.

The saved-album table shows the intended ownership:

```python source="app/crate/db/core.py#L646-L653" commit="fb7b3ffaa965579bac8f6b93460ce2d5f0764c27" "PRIMARY KEY (user_id, album_id)"
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_saved_albums (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                album_id INTEGER NOT NULL REFERENCES library_albums(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, album_id)
            )
        """)
```

The primary key allows both `(7, 42)` and `(12, 42)`. It rejects a second `(7, 42)`. The insert used
`ON CONFLICT DO NOTHING` and returned whether it added a row, which became the endpoint's `added`
field. A repeated Save request could therefore succeed with `added: false`; the relationship was
already present.
[Save and unsave operations](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/db/user_library.py#L44-L56).

The foreign keys set the direction of cleanup. Removing a user deletes that user's saved-album rows.
Removing a catalogue album deletes references to that album. Deleting a saved-album row does neither:
it only removes that person's selection. The Save button never needed to copy an audio file.

Reading the Library joined these small relationship rows back to `library_albums`, filtered by
`user_id` and ordered by the time of the save. Album name, artwork availability and duration came from
the shared catalogue. We did not store a second copy of those fields for every listener.
[Saved-album query](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/db/user_library.py#L59-L68).

Starting with empty saved-album lists, the requests produce these results:

| Request | Response detail | A's saved albums | B's saved albums |
| --- | --- | --- | --- |
| A saves album 42 | `added: true` | Album 42 | Empty |
| B saves album 42 | `added: true` | Album 42 | Album 42 |
| A saves album 42 again | `added: false` | Album 42 | Album 42 |
| A removes album 42 | `ok: true` | Empty | Album 42 |

A and B each read their column through `GET /api/me/albums`; the response includes the album fields
from the join. A's removal calls `DELETE /api/me/albums/42`, whose database operation includes both
`user_id = 7` and `album_id = 42`. There is no request parameter that selects B's saved relationship.
[Personal-album read and removal routes](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/api/me.py#L70-L93).

![Two authenticated listeners save album 42. The API obtains each user ID from authentication and writes separate user-and-album pairs, both referring to one shared catalogue album.](/blog/one-library-more-than-one-listener/personal-library.svg)

The catalogue row and the audio files do not change during this sequence. A can still browse the
record after removing it from Library. B's saved relationship is still `(12, 42)`. The two Library
responses differ because of the account filter, not because Crate created a separate catalogue.

## The two Library pages diverge

After A's removal, an album card could still appear in Browse and disappear from A's Library. B's
Library still included it. Listen gave those views separate jobs: its Library page loaded playlists,
followed artists, saved albums and liked tracks for the current account. The artist Follow button and
track hearts also used `/api/me`.
[The first personal Library page](https://github.com/thecrateapp/crate/blob/12970df7001fee733c1c750bb25c364068348cb0/app/listen/src/pages/Library.tsx).

A and B could also follow different artists while listening to the same album. The first feed
queried each account's followed artists, then selected recent library albums and upcoming shows for
those names. It also added new-release detections from a shared query. Different follow lists changed
part of the feed; they did not make every entry personal.
[Initial feed implementation](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/api/me.py#L142-L192).

Playing a track from the album wrote another kind of personal row. When the audio element emitted
`ended`, Listen posted the track and display metadata to `/api/me/history`. The server attached the
account and timestamp. A completed play submitted under A's login belonged to A's history, even if B
had saved the same album. Replaying the track could add another row: history had a separate primary
key rather than the unique user-and-track pair used by likes.
[Player history submission](https://github.com/thecrateapp/crate/blob/12970df7001fee733c1c750bb25c364068348cb0/app/listen/src/contexts/PlayerContext.tsx#L185-L213),
[history insertion](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/db/user_library.py#L116-L121).

That implementation could miss listening. Closing a tab or skipping a track before `ended` did not
submit this event. A failed request was swallowed, and the submission had no durable retry queue or
event ID for deduplication. The early counts described completed tracks whose history request reached
the server. They left out listening that stopped before the end of a track or failed to reach the API.

Names and paths made the other tables less durable. An artist follow was keyed by
`(user_id, artist_name)`, and a like by `(user_id, track_path)`. Renaming an artist or moving a file could
break the lookup unless a migration carried the relationship along. Adding a user ID solved whose
choice it was; it did not solve the identity of the music being chosen.
[The original personal-library schema](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/db/core.py#L635-L677).

That is why the stable identities discussed earlier in the series mattered to listeners as well as
the importer. A path change should not make a song disappear from someone's likes.

The later personal-library query tests use two accounts to check that follows, counts and history
stay scoped to the requested user. They exercise those reads independently of which account the UI
happens to show. The early history submission still had the delivery gaps described above.
[User-library isolation tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_user_library_queries.py).

## A sends a request for B's playlist

The playlist list needed the same account filter as saved albums. We changed `get_playlists()` to
`get_playlists(user_id=user["id"])`, so A's list no longer included B's playlists. Individual playlist
reads, edits and deletion also compared the owner with the authenticated user, with an explicit
administrator exception. For our two ordinary accounts, a direct request from A for B's playlist
now failed with `403`, even when A knew its ID.
[Initial playlist ownership checks](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/api/playlists.py#L79-L143).

We put this enforcement in application code. PostgreSQL also offers row security policies that can
restrict which rows a database role may read or change; that would move part of the enforcement into
the database. Crate's implementation used explicit predicates and permission checks instead. It
therefore depended on every relevant route supplying the account and checking the requested object.
[PostgreSQL row security policies](https://www.postgresql.org/docs/15/ddl-rowsecurity.html).

The track endpoints omitted that owner check. A could be forbidden from opening B's playlist and
still add tracks to it through another route. Adding, removing and reordering tracks
checked that someone was logged in, then reached the mutation without checking the playlist's owner.
Protecting the playlist's read route had done nothing to protect those separate requests.
[The early track-mutation routes](https://github.com/thecrateapp/crate/blob/fb7b3ffaa965579bac8f6b93460ce2d5f0764c27/app/crate/api/playlists.py#L148-L171).

In April, those mutations began loading the playlist and checking edit permission before changing
its tracks. B has not added A as a collaborator, and neither account is an administrator, so the
added guard rejected A's request before `add_playlist_tracks()` could run:

```python source="app/crate/api/playlists.py#L197-L208" commit="647a1d6164abf37cce5b2c8debea9547f32d8778" "can_edit_playlist"
@router.post("/{playlist_id}/tracks")
def add_tracks(request: Request, playlist_id: int, body: AddTracksRequest):
    user = _require_auth(request)
    pl = get_playlist(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if user.get("role") != "admin" and not can_edit_playlist(pl, user["id"]):
        raise HTTPException(status_code=403, detail="Not allowed to edit this playlist")
    if not body.tracks:
        raise HTTPException(status_code=422, detail="No tracks provided")
    add_playlist_tracks(playlist_id, body.tracks)
    return {"ok": True, "added": len(body.tracks)}
```

Removal and reorder gained the same guard. Using `can_edit_playlist` also gave collaboration somewhere
to fit: an owner and an invited collaborator could have different relationships to the playlist while
both being allowed to edit it. Public visibility and permission to edit remained separate decisions.
The [collaboration chapter](/blog/sharing-a-collection-without-giving-away-its-ownership) follows those
relationships through their later revisions. For A and B here, every request that changed the
playlist now had to answer who was allowed to make that change.

The later playlist access tests distinguish a creator, a collaborator and an unrelated viewer,
including a viewer who can see a public playlist but cannot edit it. That coverage belongs to the
later permission model; the March routes above show why checking only the top-level object was
insufficient.
[Playlist access tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_playlist_access.py).

## When A logs out

The album ID is not enough to decide what a request can read or change. Every operation above also
needed a current account. When the browser changed from A to B, `/api/me` had to resolve that next
request to user `12`, not retain the authority of the previous login.

Early Crate read `Remote-User` and `Remote-Groups` headers from the authentication proxy. That supplied
a name and groups on a request, with no local user ID in the middleware's result.
[The original authentication middleware](https://github.com/thecrateapp/crate/blob/53f9e849c16bf1ea693775739d8cf0abee949d93/app/musicdock/api/auth.py#L103-L130).

Trusted-header authentication can still support a personal application. Authelia documents how a
trusted reverse proxy passes identity headers to the downstream service; the service then has to map
that identity to its own data. The trust boundary also depends on preventing clients from supplying
those headers themselves.
[Authelia's trusted-header integration](https://www.authelia.com/integration/trusted-header-sso/introduction/).

We added local PostgreSQL users, password login and Google OAuth. Password and Google login both ended
by issuing a Crate token containing the local `user_id`. That gave the rest of the application one key
to use regardless of how the person signed in. The first version also retained the proxy fallback,
so an authenticated request could still lack that local ID. Personal-library operations needed a
resolved Crate account. The headers alone could not supply `7` or `12` for the saved-album relationship.
[Initial login and account implementation](https://github.com/thecrateapp/crate/blob/53f9e849c16bf1ea693775739d8cf0abee949d93/app/musicdock/api/auth.py).

The original login returned a signed JWT in an HTTP-only cookie. It carried the user ID, email, role
and a 24-hour expiry. The middleware verified the token and built the request's user from those
claims. Logout cleared the browser's cookie.
[Original token creation](https://github.com/thecrateapp/crate/blob/53f9e849c16bf1ea693775739d8cf0abee949d93/app/musicdock/auth.py),
[original logout](https://github.com/thecrateapp/crate/blob/53f9e849c16bf1ea693775739d8cf0abee949d93/app/musicdock/api/auth.py#L176-L181).

If A logged out and B logged in on that browser, the next request could carry B's token and resolve
to user `12`. But a copy of A's old signed token was still valid until expiry. Clearing the browser's
cookie had not given the server a reason to reject it. Nor was there an individual login to select
when A wanted to disconnect another device.

Server-side session storage is one established way to make logout enforceable beyond the browser.
Django's default session backend stores sessions in the database; its signed-cookie backend documents
the different replay behaviour, including that a stolen cookie is not invalidated when its owner
logs out. The choice changes what the server can revoke.
[Django session backends](https://docs.djangoproject.com/en/5.2/topics/http/sessions/#using-cookie-based-sessions).

We kept JWTs, but new logins began creating a PostgreSQL session as well. The login helper generated
a random session ID, stored it with the user and expiry, and included it as `sid` in the JWT. The
session also held the app, device label and activity metadata needed to list a person's logins.
[Session creation](https://github.com/thecrateapp/crate/blob/647a1d6164abf37cce5b2c8debea9547f32d8778/app/crate/api/auth.py#L258-L278).

For those tokens, signature verification was followed by a lookup of the session:

```python source="app/crate/api/auth.py#L357-L367" commit="647a1d6164abf37cce5b2c8debea9547f32d8778" "revoked_at"
        if token:
            payload = verify_jwt(token)
            if payload:
                session_id = payload.get("sid")
                session = get_session(session_id) if session_id else None
                if session_id and (
                    not session
                    or session.get("revoked_at") is not None
                    or (session.get("expires_at") and session["expires_at"] <= datetime.now(timezone.utc))
                ):
                    payload = None
```

For a token with `sid`, logout now changed what happened if someone sent that token again. It marked
the session revoked before clearing the cookie; the middleware rejected a missing, revoked or expired
session. Account settings could also list logins, revoke one or revoke the others while keeping the
current login. Revoking A's login did not require changing B's account or its saved albums.
[Session logout and management routes](https://github.com/thecrateapp/crate/blob/647a1d6164abf37cce5b2c8debea9547f32d8778/app/crate/api/auth.py#L473-L591).

Requests carrying the new tokens consulted session state, and the early middleware touched activity
metadata during authentication. Keeping login authority in PostgreSQL created database work on the
request path. Later auth-cache and presence changes refined that work; they did not remove the need
to check whether a login was still allowed.

B's next authenticated Library request could still return album 42. Revocation changed the authority
of A's session; it did not delete the saved relationships. In this version, though, the session check
only ran when the JWT contained `sid`. An older token without it still followed the earlier path.
New logins could be revoked; previously issued tokens had not all become database-backed sessions.
