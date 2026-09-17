"""Dockerized end-to-end interoperability probes for the OpenSubsonic profile."""

from __future__ import annotations

import hashlib
import json
import os
import struct
import urllib.error
import urllib.parse
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_VERSION = "1.16.1"
SMOKE_CLIENT = "crate-opensubsonic-smoke"

EXTENSION_PROBES = {
    "formPost": "form_post_authentication",
    "indexBasedQueue": "index_based_queue_round_trip",
    "songLyrics": "structured_song_lyrics",
    "topSongsByArtistId": "top_songs_by_artist_id",
}

REQUIRED_PROTOCOL_SCENARIOS = (
    "unauthenticated_extension_discovery",
    "api_key_authentication",
    "password_authentication",
    "token_salt_authentication",
    "artist_album_track_browse",
    "artwork_resolution",
    "search_and_genres",
    "playlist_crud",
    "star_rating_and_scrobble",
    "queue_save_restore",
    "stream_seek_and_download",
    "advertised_extensions",
)


@dataclass(frozen=True)
class SmokeFixture:
    username: str
    secret: str
    artist_id: str
    album_id: str
    track_id: str


class SmokeClient:
    def __init__(self, base_url: str, fixture: SmokeFixture) -> None:
        self.base_url = base_url.rstrip("/")
        self.fixture = fixture

    def json(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
        *,
        auth: dict[str, str] | None = None,
        method: str = "GET",
        form: bool = False,
    ) -> dict[str, Any]:
        common = {"v": API_VERSION, "c": SMOKE_CLIENT, "f": "json"}
        credentials = self.password_auth() if auth is None else auth
        values = {**common, **credentials, **(params or {})}
        request = self._request(endpoint, values, method=method, form=form)
        content_type = next(
            (
                value
                for key, value in request.headers.items()
                if key.casefold() == "content-type"
            ),
            "",
        )
        if "json" not in content_type:
            raise AssertionError(f"{endpoint} did not return a JSON response")
        try:
            payload = json.loads(request.body)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise AssertionError(f"{endpoint} returned invalid JSON") from error
        envelope = payload.get("subsonic-response")
        if not isinstance(envelope, dict):
            raise AssertionError(f"{endpoint} omitted the Subsonic response envelope")
        return envelope

    def binary(
        self,
        endpoint: str,
        params: dict[str, Any],
        *,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        response = self._request(
            endpoint,
            {
                "v": API_VERSION,
                "c": SMOKE_CLIENT,
                "f": "json",
                **self.password_auth(),
                **params,
            },
            headers=headers,
        )
        return response.status, response.headers, response.body

    def password_auth(self) -> dict[str, str]:
        return {"u": self.fixture.username, "p": self.fixture.secret}

    def _request(
        self,
        endpoint: str,
        params: dict[str, Any],
        *,
        method: str = "GET",
        form: bool = False,
        headers: dict[str, str] | None = None,
    ) -> SmokeResponse:
        encoded = urllib.parse.urlencode(params, doseq=True)
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        body = None
        request_headers = dict(headers or {})
        if form:
            body = encoded.encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif method.upper() == "GET":
            url = f"{url}?{encoded}"
        else:
            body = encoded.encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"

        request = urllib.request.Request(
            url,
            data=body,
            headers=request_headers,
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return SmokeResponse(
                    int(response.status),
                    dict(response.headers.items()),
                    response.read(),
                )
        except urllib.error.HTTPError as error:
            return SmokeResponse(
                int(error.code),
                dict(error.headers.items()),
                error.read(),
            )
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError(
                f"Could not reach OpenSubsonic endpoint {endpoint}"
            ) from error


@dataclass(frozen=True)
class SmokeResponse:
    status: int
    headers: dict[str, str]
    body: bytes


def _assert_ok(envelope: dict[str, Any], endpoint: str) -> dict[str, Any]:
    if envelope.get("status") != "ok":
        error = envelope.get("error") or {}
        raise AssertionError(
            f"{endpoint} failed with protocol code {error.get('code')}: "
            f"{error.get('message', 'unknown error')}"
        )
    return envelope


def _seed_fixture() -> SmokeFixture:
    from PIL import Image
    from sqlalchemy import text

    from crate.db.queries.subsonic_global import (
        get_global_album_by_local_id,
        get_global_artist_by_local_id,
        get_global_track_by_local_id,
    )
    from crate.db.queries.subsonic_user_queries import get_user_by_username
    from crate.db.orm.library import LibraryArtist
    from crate.db.repositories.lyrics import store_lyrics
    from crate.db.repositories.library_album_upserts import upsert_album
    from crate.db.repositories.library_artist_upserts import upsert_artist
    from crate.db.repositories.library_track_reads import get_library_track_by_path
    from crate.db.repositories.library_track_upserts import upsert_track
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog
    from crate.subsonic.auth import create_user_credential
    from sqlalchemy import select

    root = Path(os.environ.get("CRATE_SMOKE_MUSIC_ROOT", "/music")).resolve()
    artist_name = "Crate OpenSubsonic Smoke Fixture"
    album_name = "Protocol Contract"
    title = "A Deterministic Test Track"
    album_path = root / artist_name / album_name
    album_path.mkdir(parents=True, exist_ok=True)
    audio_path = album_path / "01 - A Deterministic Test Track.wav"
    cover_path = album_path / "cover.jpg"

    sample_rate = 8_000
    frame_count = sample_rate * 4
    with wave.open(str(audio_path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(struct.pack("<h", 0) * frame_count)
    Image.new("RGB", (16, 16), color=(9, 188, 205)).save(cover_path, format="JPEG")

    upsert_artist({"name": artist_name, "folder_name": artist_name})
    local_album_id = upsert_album(
        {
            "artist": artist_name,
            "name": album_name,
            "path": str(album_path),
            "track_count": 1,
            "total_size": audio_path.stat().st_size,
            "total_duration": 4,
            "formats": ["wav"],
            "year": "2026",
            "genre": "rock",
            "has_cover": 1,
        }
    )
    upsert_track(
        {
            "album_id": local_album_id,
            "artist": artist_name,
            "album": album_name,
            "filename": audio_path.name,
            "title": title,
            "path": str(audio_path),
            "track_number": 1,
            "disc_number": 1,
            "format": "wav",
            "duration": 4,
            "size": audio_path.stat().st_size,
            "genre": "rock",
        }
    )
    track = get_library_track_by_path(str(audio_path))
    if not track:
        raise RuntimeError("Smoke track was not persisted in the local catalog")
    local_track_id = int(track["id"])

    reconcile_local_catalog()
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET lastfm_playcount = 1 WHERE id = :id"),
            {"id": local_track_id},
        )

    store_lyrics(
        artist_name,
        title,
        synced_lyrics="[00:00.00]OpenSubsonic smoke lyric",
        track_id=local_track_id,
        track_entity_uid=str(track["entity_uid"]),
    )

    user = get_user_by_username("admin")
    if not user:
        raise RuntimeError("The API startup did not seed the smoke admin user")
    secret = create_user_credential(int(user["id"]))

    with read_scope() as session:
        local_artist_id = session.execute(
            select(LibraryArtist.id).where(LibraryArtist.name == artist_name)
        ).scalar_one()
    artist = get_global_artist_by_local_id(int(local_artist_id))
    album = get_global_album_by_local_id(local_album_id)
    global_track = get_global_track_by_local_id(local_track_id)
    if not artist or not album or not global_track:
        raise RuntimeError("Smoke fixture was not projected to the global catalog")

    return SmokeFixture(
        username=str(user.get("username") or "admin"),
        secret=secret,
        artist_id=f"ga-{artist['global_artist_uid']}",
        album_id=f"gal-{album['global_album_uid']}",
        track_id=f"gt-{global_track['global_track_uid']}",
    )


def run_smoke(base_url: str | None = None) -> None:
    from crate.subsonic.capabilities import advertised_extensions

    endpoint = base_url or os.environ.get(
        "CRATE_OPENSUBSONIC_BASE_URL", "http://api:8585/rest"
    )
    fixture = _seed_fixture()
    client = SmokeClient(endpoint, fixture)
    completed: set[str] = set()

    def scenario(name: str, action) -> Any:
        result = action()
        completed.add(name)
        print(f"PASS {name}", flush=True)
        return result

    extensions = scenario(
        "unauthenticated_extension_discovery",
        lambda: _assert_ok(
            client.json("getOpenSubsonicExtensions", auth={}),
            "getOpenSubsonicExtensions",
        ).get("openSubsonicExtensions", []),
    )
    advertised_names = {item.get("name") for item in extensions}
    if advertised_names != set(EXTENSION_PROBES):
        raise AssertionError(
            "Advertised OpenSubsonic extensions do not match the smoke probe registry"
        )
    expected_extensions = {item["name"] for item in advertised_extensions()}
    if advertised_names != expected_extensions:
        raise AssertionError(
            "Server extension discovery differs from its capability registry"
        )

    scenario(
        "api_key_authentication",
        lambda: _assert_ok(
            client.json("ping", auth={"apiKey": fixture.secret}), "ping (apiKey)"
        ),
    )
    scenario(
        "password_authentication",
        lambda: _assert_ok(client.json("ping"), "ping (u+p)"),
    )
    salt = "crate-opensubsonic-smoke-salt"
    token = hashlib.md5(
        f"{fixture.secret}{salt}".encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    scenario(
        "token_salt_authentication",
        lambda: _assert_ok(
            client.json("ping", auth={"u": fixture.username, "t": token, "s": salt}),
            "ping (u+t+s)",
        ),
    )

    def browse() -> dict[str, Any]:
        index = _assert_ok(client.json("getArtists"), "getArtists").get("artists", {})
        indexed_artists = [
            artist
            for item in index.get("index", [])
            for artist in item.get("artist", [])
        ]
        if not any(item.get("id") == fixture.artist_id for item in indexed_artists):
            raise AssertionError("Smoke artist was missing from getArtists")
        artist = _assert_ok(
            client.json("getArtist", {"id": fixture.artist_id}), "getArtist"
        ).get("artist", {})
        if not any(
            item.get("id") == fixture.album_id for item in artist.get("album", [])
        ):
            raise AssertionError("Smoke album was missing from getArtist")
        album = _assert_ok(
            client.json("getAlbum", {"id": fixture.album_id}), "getAlbum"
        ).get("album", {})
        songs = album.get("song", [])
        if not any(item.get("id") == fixture.track_id for item in songs):
            raise AssertionError("Smoke track was missing from getAlbum")
        return {"artist": artist, "album": album, "song": songs[0]}

    browse_data = scenario("artist_album_track_browse", browse)

    def artwork() -> None:
        status, headers, body = client.binary("getCoverArt", {"id": fixture.album_id})
        media_type = next(
            (value for key, value in headers.items() if key.lower() == "content-type"),
            "",
        )
        if status != 200 or not media_type.startswith("image/") or not body:
            raise AssertionError("Smoke album artwork did not resolve to image bytes")

    scenario("artwork_resolution", artwork)

    def search_and_genres() -> None:
        search = _assert_ok(
            client.json("search3", {"query": "Deterministic Test Track"}), "search3"
        ).get("searchResult3", {})
        if not any(
            item.get("id") == fixture.track_id for item in search.get("song", [])
        ):
            raise AssertionError("Smoke track was missing from search3")
        genres = _assert_ok(client.json("getGenres"), "getGenres").get("genres", {})
        genre_rows = genres.get("genre", [])
        genre_name = "rock"
        if not any(
            str(item.get("value") or item.get("name") or "").casefold()
            == genre_name.casefold()
            for item in genre_rows
        ):
            raise AssertionError("Smoke genre was missing from getGenres")
        songs = (
            _assert_ok(
                client.json("getSongsByGenre", {"genre": genre_name}), "getSongsByGenre"
            )
            .get("songsByGenre", {})
            .get("song", [])
        )
        if not any(item.get("id") == fixture.track_id for item in songs):
            raise AssertionError(
                "Smoke track was missing from getSongsByGenre; "
                f"expected {fixture.track_id}, returned "
                f"{[item.get('id') for item in songs]}"
            )

    scenario("search_and_genres", search_and_genres)

    def playlist_crud() -> None:
        created = _assert_ok(
            client.json(
                "createPlaylist",
                {"name": "OpenSubsonic Smoke", "songId": [fixture.track_id]},
            ),
            "createPlaylist",
        ).get("playlist", {})
        playlist_id = str(created.get("id") or "")
        if not playlist_id:
            raise AssertionError("createPlaylist did not return a playlist ID")
        client.json(
            "updatePlaylist",
            {
                "playlistId": playlist_id,
                "name": "OpenSubsonic Smoke Updated",
                "comment": "smoke",
            },
        )
        updated = _assert_ok(
            client.json("getPlaylist", {"id": playlist_id}), "getPlaylist"
        ).get("playlist", {})
        if updated.get("name") != "OpenSubsonic Smoke Updated" or not updated.get(
            "entry"
        ):
            raise AssertionError(
                "Playlist create/update did not round-trip its metadata and track"
            )
        _assert_ok(client.json("deletePlaylist", {"id": playlist_id}), "deletePlaylist")
        listed = _assert_ok(client.json("getPlaylists"), "getPlaylists")
        remaining = listed.get("playlists", {}).get("playlist", [])
        if any(item.get("id") == playlist_id for item in remaining):
            raise AssertionError("Deleted smoke playlist remained in getPlaylists")

    scenario("playlist_crud", playlist_crud)

    def star_rating_scrobble() -> None:
        _assert_ok(client.json("star", {"id": fixture.track_id}), "star")
        starred = _assert_ok(client.json("getStarred2"), "getStarred2").get(
            "starred2", {}
        )
        if not any(
            item.get("id") == fixture.track_id for item in starred.get("song", [])
        ):
            raise AssertionError("Starred track was missing from getStarred2")
        _assert_ok(
            client.json("setRating", {"id": fixture.track_id, "rating": 5}),
            "setRating",
        )
        rated = _assert_ok(
            client.json("getSong", {"id": fixture.track_id}), "getSong"
        ).get("song", {})
        if rated.get("userRating") != 5:
            raise AssertionError("Track rating did not round-trip through getSong")
        _assert_ok(
            client.json("scrobble", {"id": [fixture.track_id], "submission": "true"}),
            "scrobble",
        )

    scenario("star_rating_and_scrobble", star_rating_scrobble)

    def queue_round_trip() -> None:
        _assert_ok(
            client.json(
                "savePlayQueueByIndex",
                {"id": [fixture.track_id], "currentIndex": 0, "position": 1000},
            ),
            "savePlayQueueByIndex",
        )
        queue = _assert_ok(
            client.json("getPlayQueueByIndex"), "getPlayQueueByIndex"
        ).get("playQueue", {})
        if queue.get("currentIndex") != 0 or not queue.get("entry"):
            raise AssertionError("Index-based play queue did not round-trip")
        if queue["entry"][0].get("id") != fixture.track_id:
            raise AssertionError("Restored queue returned a different track")

    scenario("queue_save_restore", queue_round_trip)

    def stream_seek_download() -> None:
        status, headers, body = client.binary(
            "stream",
            {"id": fixture.track_id, "format": "raw"},
            headers={"Range": "bytes=0-63"},
        )
        content_range = next(
            (value for key, value in headers.items() if key.lower() == "content-range"),
            "",
        )
        if (
            status != 206
            or len(body) != 64
            or not content_range.startswith("bytes 0-63/")
        ):
            raise AssertionError("Range seek did not return the requested stream bytes")
        status, headers, body = client.binary("download", {"id": fixture.track_id})
        if status != 200 or len(body) <= 44:
            raise AssertionError("Track download did not return the original WAV")
        media_type = next(
            (value for key, value in headers.items() if key.lower() == "content-type"),
            "",
        )
        if not media_type.startswith("audio/"):
            raise AssertionError("Track download did not return an audio content type")

    scenario("stream_seek_and_download", stream_seek_download)

    def extension_probes() -> None:
        form_response = _assert_ok(
            client.json(
                "ping",
                auth=client.password_auth(),
                method="POST",
                form=True,
            ),
            "ping form POST",
        )
        del form_response
        queue_round_trip()
        lyrics = (
            _assert_ok(
                client.json("getLyricsBySongId", {"id": fixture.track_id}),
                "getLyricsBySongId",
            )
            .get("lyricsList", {})
            .get("structuredLyrics", [])
        )
        if not lyrics:
            raise AssertionError("Seeded structured lyrics were not returned")
        top_songs = (
            _assert_ok(
                client.json("getTopSongs", {"id": fixture.artist_id}), "getTopSongs"
            )
            .get("topSongs", {})
            .get("song", [])
        )
        if not any(item.get("id") == fixture.track_id for item in top_songs):
            raise AssertionError(
                "topSongsByArtistId did not return its ranked smoke track"
            )

    scenario("advertised_extensions", extension_probes)
    if completed != set(REQUIRED_PROTOCOL_SCENARIOS):
        missing = sorted(set(REQUIRED_PROTOCOL_SCENARIOS) - completed)
        raise AssertionError(f"Smoke harness omitted required scenarios: {missing}")

    del browse_data
    print(f"OpenSubsonic smoke passed: {len(completed)} protocol scenarios")


def main() -> None:
    run_smoke()


if __name__ == "__main__":
    main()
