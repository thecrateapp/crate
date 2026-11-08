---
title: "Taking playback over from Navidrome"
description: "Listen began with two playback routes. Removing Navidrome meant reconciling track identity, serving audio and owning the state around every play."
date: 2026-11-24
draft: true
series:
  id: how-to-forget-spotify
  title: "How to forget Spotify. Building Crate from the ground."
  part: 3
related: [smart-mix-planned-on-the-server, reads-from-snapshots]
tags: [How to forget Spotify, playback, Listen, architecture, history]
sources:
  - docs/technical/09-playback-realtime-and-subsonic.md
  - docs/technical/08-frontends-admin-and-listen.md
  - docs/technical/listen-media-access.md
---

_Part 3. Moving playback into Crate, 19 March–11 April 2026._

Listen could play a track that it couldn't save to a playlist. Our Save as Playlist handler sent
`track_path` where the API expected `path`. When a track had no local path, the client fell back to
its `id`, which could belong to Navidrome. We were sending a song ID from another server to code
that needed a file in Crate's library.

We [fixed the payload](https://github.com/thecrateapp/crate/commit/53e180f49dc345be1ada56299a6db830a42a8206)
and excluded queue entries without a local path. By then, Crate could already serve audio files and
had its own listening app. Navidrome still supplied another playback route and several pieces of
user state. The queue could contain tracks from either system, but saving it required a local path
for every entry.

In the [previous chapter](/blog/filesystem-to-indexed-catalogue), we moved the catalogue into PostgreSQL.
Playback still depended on more than those catalogue rows. We added direct file streaming before
building Listen, then kept both routes in its first player. Removing Navidrome meant choosing a
track identity, taking over media delivery and replacing the services around each play.

## The problem: the same recording had two identities

Our first player lived inside the administration interface. Its media request went through
`/api/navidrome/stream/{song_id}`, which proxied Navidrome. Both applications could see the same
audio files, but each maintained its own view of the collection.
[Initial proxy](https://github.com/thecrateapp/crate/blob/211f715c1404f083b7812acad584d4b552d3e2bc/librarian/librarian/api/navidrome.py#L36-L48).

That difference reached the album page. Crate knew a directory such as `1997 - Example Album`;
Navidrome knew the album name from its tags. Searching with the directory name could fail to find
music that was present in both systems. We first stripped the year prefix from the directory name,
then changed the lookup to prefer the actual `ALBUM` tag. The matching function checked the
MusicBrainz release ID before falling back to name matching.
[Album reconciliation](https://github.com/thecrateapp/crate/blob/98faf88877a128b09429d0aacbbcf0ad1d450467/app/musicdock/navidrome.py#L163-L215).

The proxy also had to preserve the browser's request. Seeking within a track can trigger a byte-range
request. We advertised range support but didn't forward the browser's `Range` header or preserve the
upstream partial-response status and headers. We fixed both sides: forward the requested range to
Navidrome, then return its status, length and range metadata:

```python source="app/musicdock/api/navidrome.py#L54-L68" commit="971d50b779dd8bf1197939ee47642327de5f5df1" "Content-Range"
        content_type = resp.headers.get("content-type", "audio/mpeg")
        status_code = resp.status_code  # 200 or 206 for partial content

        headers: dict[str, str] = {"Accept-Ranges": "bytes"}
        if "content-length" in resp.headers:
            headers["Content-Length"] = resp.headers["content-length"]
        if "content-range" in resp.headers:
            headers["Content-Range"] = resp.headers["content-range"]

        return StreamingResponse(
            resp.iter_content(chunk_size=8192),
            status_code=status_code,
            media_type=content_type,
            headers=headers,
        )
```

For a partial response, the browser needs to know which bytes it received. HTTP's `Range` request
header and `Content-Range` response header describe those intervals; `Accept-Ranges` advertises
support. Copying only the audio body loses part of that contract.
[RFC 9110, range requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests).

We added mappings between Crate's catalogue and Navidrome IDs, plus synchronization for favourites
and playlists. Those mappings still needed maintenance after we added direct streaming, because the
listening features continued to use both systems.
[Integration and ID mapping](https://github.com/thecrateapp/crate/commit/08b98db4945272db36f5088d52d3520e8c40f423).

An album could exist locally but fail external matching. A queue item could play through one route
and fail when another feature treated its identifier as a path. Each listening feature had to know
which representation it had received, even though both represented files in the same collection.

## Investigation: a listening app did not require a new server

We could build Listen while keeping Navidrome as the music server. Navidrome provides a browser
player, support for Subsonic clients, per-user favourites and playlists, transcoding and scrobbling.
A custom interface can use those services instead of implementing them again.
[Navidrome overview](https://www.navidrome.org/docs/overview/).

The Subsonic streaming interface also makes the boundary explicit: the client requests a server-owned
media ID and can ask for a bitrate or target format. The ID belongs to that server's catalogue; it is
not a portable filesystem path.
[OpenSubsonic stream endpoint](https://opensubsonic.netlify.app/docs/endpoints/stream/).

That was our initial design for Listen: a consumer application separate from Admin, reusing Crate's
API and keeping Navidrome behind a streaming proxy. The new interface would hide that dependency
from the listener while still using it to deliver audio.
[Original Listen design](https://github.com/thecrateapp/crate/blob/7b2c3de786ded7a9e203ee9dabccf0cc6fdcee3d/docs/plans/2026-03-28-crate-listen-design.md#L8-L33).

We also had a direct-stream endpoint as a fallback when Navidrome was unavailable. It resolved a
library path, checked that it named a file, selected a media type and returned a `FileResponse`.
That was enough to serve the original audio file. It gave us no transcoding pipeline.
[First direct-stream endpoint](https://github.com/thecrateapp/crate/blob/d50ce855be0fb8aec7edeceddb37ce340697e07b/app/musicdock/api/browse.py#L542-L564).

We kept both routes for several weeks. With Navidrome, we had to maintain the catalogue and account
bridges. Serving our own files removed those translations, but made us responsible for media delivery
and the user state we had delegated to Navidrome. The direct-stream route covered only one part of
that work. Favourites, playlists, scrobbling and external clients still needed their own paths.

![Three stages of playback ownership: the early Admin player proxies Navidrome; the first Listen can request either a local file or a Navidrome stream; by 11 April, Listen uses Crate's catalogue and file-serving routes.](/blog/taking-playback-over-from-navidrome/playback-ownership.svg)

[Open the ownership diagram at full size](/blog/taking-playback-over-from-navidrome/playback-ownership.svg).

## Implementation: keep the player alive while the catalogue changes

### Put playback above the routed pages

We split the interfaces by what people were doing. Admin handled repairs, imports and analysis;
Listen handled album browsing, discovery and playback. In Listen, we placed `PlayerProvider` above
the routed pages so navigating from an album to an artist didn't create a new player for each screen.
[Application composition](https://github.com/thecrateapp/crate/blob/7b2c3de786ded7a9e203ee9dabccf0cc6fdcee3d/app/listen/src/App.tsx#L29-L67).

The first provider kept an `Audio` element in a ref and saved the queue and current index when they
changed:

<!-- prettier-ignore -->
```typescript source="app/listen/src/contexts/PlayerContext.tsx#L145-L153" commit="7b2c3de786ded7a9e203ee9dabccf0cc6fdcee3d" "audioRef.current"
  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.volume = getStoredVolume();
  }
  const audio = audioRef.current;

  useEffect(() => {
    saveQueue(queue, currentIndex);
  }, [queue, currentIndex]);
```

React held the queue and selected track; the media element played the current URL. Pages supplied
tracks to the provider instead of constructing their own audio elements. The saved queue lived in
that browser's local storage. It did not synchronize a listening session across devices.

The stream selector still recognized two different meanings of `Track.id`:

```typescript source="app/listen/src/contexts/PlayerContext.tsx#L124-L128" commit="7b2c3de786ded7a9e203ee9dabccf0cc6fdcee3d" "track.id.includes"
function getStreamUrl(track: Track): string {
  return track.id.includes("/")
    ? `/api/stream/${encodeURIComponent(track.id).replace(/%2F/g, "/")}`
    : `/api/navidrome/stream/${track.id}`;
}
```

A slash meant a local path. An opaque ID went to Navidrome. This let Listen reuse both working routes.
When we connected album browsing to the player, the adapter preferred a track's path when creating a
queue entry, with a string ID as the fallback.
[Album-to-player adapter](https://github.com/thecrateapp/crate/blob/18987bb6bcd7e95a9538fab454f53a75be1b92b2/app/listen/src/pages/Album.tsx#L52-L60).

Admin's Play All needed the same treatment. Its handler returned early when it had no Navidrome
songs, even though we could already stream local files. We changed the button to use local tracks
when Navidrome data was absent.
[Play All fallback](https://github.com/thecrateapp/crate/commit/13f66e121193cc9356cbe44700020647c33926bd).

Every producer of queue entries needed the same attention: it had to supply an identity that the
chosen stream route understood.

### Stop treating every track string as a file path

The playlist bug at the start of this post came from that mixed queue model. We changed the handler
to keep only entries with a path and send the field expected by the local playlist API:

```typescript source="app/listen/src/components/player/extended/QueueTab.tsx#L15-L29" commit="53e180f49dc345be1ada56299a6db830a42a8206"
  async function handleSaveAsPlaylist() {
    const validTracks = queue.filter((t) => t.path && t.path.includes("/"));
    if (!validTracks.length) {
      toast.error("No local tracks in queue to save");
      return;
    }
    try {
      await api("/api/playlists", "POST", {
        name: playSource?.name || "Queue",
        tracks: validTracks.map((t) => ({
          path: t.path,
          title: t.title,
          artist: t.artist,
          album: t.album || "",
        })),
```

The handler now sent a valid request, at the cost of leaving out entries without a local path. A
track could play through Navidrome and still be unavailable to this playlist operation. The slash
test recognized a local naming convention; it neither established track identity nor checked path safety.

We had already added a stream route that accepted a `library_tracks` ID. Listen could carry that
value separately as `libraryTrackId`. After removing
the Navidrome branch, URL selection became:

```typescript source="app/listen/src/contexts/player-utils.ts#L72-L86" commit="396b6be88e4dc58cf6ae5fc9199b9f9eeef31308" "libraryTrackId"
export function getStreamUrl(track: Track): string {
  const base = _apiBase();
  const suffix = _tokenSuffix();

  if (track.libraryTrackId != null) {
    return `${base}/api/tracks/${track.libraryTrackId}/stream${suffix}`;
  }

  const playbackPath = track.path || track.id;
  if (playbackPath.includes("/")) {
    return `${base}/api/stream/${encodeURIComponent(playbackPath).replace(/%2F/g, "/")}${suffix}`;
  }

  return `${base}/api/tracks/${track.id}/stream${suffix}`;
}
```

The preferred route now used Crate's numeric track ID. We kept a path fallback for older queue shapes,
and the final fallback interpreted the remaining ID as a Crate track ID. This left a compatibility
problem in local storage: a saved queue could still contain Navidrome-only IDs. Removing the branch
that understood them didn't convert those entries into Crate tracks.

The server resolved the numeric ID to the stored path before calling the shared file-serving helper:

```python source="app/crate/api/browse_media.py#L313-L326" commit="3341893453af7312b2735211577c6d5fcbdf6217"
@router.get("/api/tracks/{track_id}/stream")
def api_stream_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _stream_file(request, row["path"])


@router.get("/api/stream/{filepath:path}")
def api_stream_file(request: Request, filepath: str):
    return _stream_file(request, filepath)
```

Clients with a library ID could now ask for a track without assembling its current path. The server
looked it up in the catalogue from the previous chapter. That row still needed a valid path, and the
path route remained available; file renames and storage migration still needed their own handling.

### Own the byte-serving and authentication boundary

The shared helper authenticated the request, normalized known library path prefixes, called
`safe_path` and checked for an existing file. It then selected the MIME type and returned the response:

```python source="app/crate/api/browse_media.py#L305-L310" commit="3341893453af7312b2735211577c6d5fcbdf6217" "FileResponse"
    ext = file_path.suffix.lower()
    return FileResponse(
        path=str(file_path),
        media_type=_STREAM_MEDIA_TYPES.get(ext, "audio/mpeg"),
        headers={"Accept-Ranges": "bytes"},
    )
```

We delegated file delivery to the framework. The endpoint returned the original format, so the
browser had to be able to decode it. Navidrome could transcode for clients; our file-serving route
had no equivalent. Supporting a browser that couldn't play the source file would require another
stage before delivery.

Range handling also became a framework dependency. We specified `fastapi[standard]>=0.115` without
pinning Starlette, so the exact implementation depended on the version installed on the server.
Setting `Accept-Ranges` ourselves wasn't a guarantee that every seek would work: the framework still
had to handle the requested interval and return the appropriate partial response.
[Framework requirements](https://github.com/thecrateapp/crate/blob/3341893453af7312b2735211577c6d5fcbdf6217/app/requirements.txt).

![The April native playback path: Listen chooses a catalogue track ID or a legacy path; Crate authenticates, resolves the ID when needed and passes the file to FileResponse. The browser decodes the original audio, and play-event reporting is a separate request.](/blog/taking-playback-over-from-navidrome/native-playback-path.svg)

[Open the native playback diagram at full size](/blog/taking-playback-over-from-navidrome/native-playback-path.svg).

Authentication differed between ordinary API calls and media URLs. A same-origin browser could send
its session cookie. Our Capacitor client used bearer authentication for API requests, but assigning
a URL to an audio element didn't let us attach that bearer header. We appended the stored session
token to native media URLs and accepted it in the API as a fallback after cookie and bearer lookup:

```python source="app/crate/api/auth.py#L310-L319" commit="3341893453af7312b2735211577c6d5fcbdf6217" "request.query_params"
        # 1. Cookie auth (web browsers)
        token = request.cookies.get(COOKIE_NAME)
        # 2. Bearer token auth (Capacitor native app)
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        # 3. Query param token (audio/image streams where headers can't be set)
        if not token:
            token = request.query_params.get("token")
```

That put a session credential in the URL. It carried the authority of the session, so handling the
media URL also meant protecting that credential. We had removed the second login system, but still
needed to control access to the bytes. Scoped media tickets came later.
[Native media URL construction](https://github.com/thecrateapp/crate/blob/396b6be88e4dc58cf6ae5fc9199b9f9eeef31308/app/listen/src/contexts/player-utils.ts#L88-L98).

Our path guard had a separate flaw. `safe_path` resolved the path, then compared strings with
`startswith`. A path could share the library directory's string prefix without being inside it.
File serving needed a containment check; our prefix comparison didn't provide one.
[Path guard at the cutover](https://github.com/thecrateapp/crate/blob/3341893453af7312b2735211577c6d5fcbdf6217/app/crate/api/_deps.py#L62-L66).

### Handle the browser that refuses to play

A successful HTTP response still didn't guarantee sound. Our mood playback handler fetched its
track list before dealing with a suspended audio context. We added context creation or resumption
at the beginning of the click handler, ahead of the awaited request:

```typescript source="app/listen/src/pages/Explore.tsx#L268-L274" commit="853e58d23ed85101e1d3205c2702f30a4130df4c" "AudioContext"
  async function playMood(mood: string) {
    // Resume AudioContext synchronously in the user gesture before the await
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }
```

The request and queue construction followed. We also added context resumption to `playAll` and
carried `libraryTrackId` into mood-generated tracks.
[Autoplay fix](https://github.com/thecrateapp/crate/commit/853e58d23ed85101e1d3205c2702f30a4130df4c).

Browser autoplay policy depends on user activation, permissions and browser state. Resuming the
context inside the click handler addressed that timing problem. We still had to handle the result
of `play()`: its promise can reject when the browser doesn't allow playback.
[Browser autoplay and play() failures](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay#the_play_method).

We hadn't handled that result consistently. Some player paths set `isPlaying` to true immediately
after calling `play()`, while a rejection handler only logged the failure. A failed attempt could
leave the interface showing that music was playing. More ambitious preloading work also caused
regressions in playback controls and visualizers, and we rolled those stages back.
[Playback state update](https://github.com/thecrateapp/crate/blob/3341893453af7312b2735211577c6d5fcbdf6217/app/listen/src/contexts/PlayerContext.tsx#L264-L277),
[preloading rollback](https://github.com/thecrateapp/crate/blob/3341893453af7312b2735211577c6d5fcbdf6217/docs/plans/2026-03-31-listen-player-preloading-roadmap.md#L124-L129).

### Replace the services surrounding the stream

Once Listen used our media routes, we could remove its Navidrome branches for streaming and
scrobbling. We added direct Last.fm and ListenBrainz integration, native artist top tracks and a
Subsonic-compatible API for external players. The removal reached beyond the player: account
synchronization, settings, worker hooks and runtime configuration all had Navidrome dependencies.
[Frontend cutover](https://github.com/thecrateapp/crate/commit/396b6be88e4dc58cf6ae5fc9199b9f9eeef31308),
[direct scrobbling](https://github.com/thecrateapp/crate/commit/395358937fec04b854b9bd52ec3543ee46c7707d),
[service removal](https://github.com/thecrateapp/crate/commit/68d35f7a2b9bae817e101af1825e9a8a9bbbabf5),
[legacy cleanup](https://github.com/thecrateapp/crate/commit/3341893453af7312b2735211577c6d5fcbdf6217).

Our first Subsonic stream handler used `read_bytes()` to load the entire file into memory, then
returned a normal `Response`. It advertised `Accept-Ranges` without parsing the request's range
header. Each request therefore needed memory for the whole audio file, and external clients still
lacked proper range handling. Exposing the endpoint had only covered part of what those clients needed.
[Initial Subsonic stream handler](https://github.com/thecrateapp/crate/blob/3341893453af7312b2735211577c6d5fcbdf6217/app/crate/api/subsonic.py#L474-L504).

We also needed our own record of what a user had played. Downloading audio bytes and recording a
listen are separate operations; OpenSubsonic makes the same distinction between streaming and
scrobbling. Our play-event tests exercised the endpoint with mocked recording and task dispatch.
They checked the API contract. They didn't run a browser through playback and external scrobbling
together, so failures across those boundaries could pass this suite.
[Play-event contract tests](https://github.com/thecrateapp/crate/blob/3341893453af7312b2735211577c6d5fcbdf6217/app/tests/test_play_event_contracts.py#L12-L63).

## Before and after

| Concern                      | Early Navidrome integration                                     | After removing Navidrome                                                        |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Listening interface          | A player inside Admin and links to Navidrome                    | Separate Listen application with a player above its routes                     |
| Playback identity            | Navidrome song IDs, matched against Crate names and paths       | Prefer Crate catalogue IDs; retain a local-path fallback                       |
| Audio delivery               | Proxy Navidrome's media response                                | Authenticate and return the original library file through Crate                |
| Queue compatibility          | A string could mean a path or an external song ID               | Local playlist saves require a path; stream selection understands Crate IDs    |
| Accounts and listening state | Crate state plus external account and catalogue synchronization | Crate owns its account, play-event and service-integration paths               |
| External music clients       | Navidrome provides the Subsonic server                          | Crate exposes an initial compatibility API, with delivery limits still present |
| Codec handling               | Navidrome can transcode for clients                             | The native endpoint shown here serves the original format                      |
| Operational responsibility   | Run and reconcile two music catalogues                          | Run Crate's playback path and maintain its HTTP, browser and state contracts   |

By 11 April, we could run Listen against Crate's catalogue, authentication and media routes without
a Navidrome service. Selecting a track and requesting its audio could now use the same catalogue ID.
We no longer had to match that track against a second music catalogue before serving it.

A queue saved before the switch could still contain IDs that the new routes couldn't resolve. The
browser could reject playback while the UI showed it as playing. External clients had a Subsonic
endpoint that still needed proper file streaming. Removing the second server left us with those
problems to solve inside Crate.

At this stage, we were serving files through the API and playing them in a browser audio element.
The Go read plane, dedicated playback worker, native audio engines and scoped media tickets came later.

_The excerpts show the March and April implementation. The references below cover how playback and
the frontend work in Crate today._
