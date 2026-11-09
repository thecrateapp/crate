"""S3: paginated library navigation for Crate Decks (`/api/decks`)."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

_MOOD_NODES = [
    ("mood", "aggressive", "Aggressive"),
    ("mood", "dark", "Dark"),
    ("mood", "happy", "Happy"),
    ("mood", "party", "Party"),
    ("mood", "relaxed", "Relaxed"),
    ("mood", "sad", "Sad"),
]


# ── Seeding helpers ──────────────────────────────────────────────


def _user(name: str) -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    "INSERT INTO users (email, username, created_at) "
                    "VALUES (:email, :name, now()) RETURNING id"
                ),
                {"email": f"{name}@example.test", "name": name},
            ).scalar_one()
        )


def _act_as(monkeypatch, user_id: int, username: str = "dj") -> None:
    async def _resolve(self, request):
        return {"id": user_id, "role": "user", "username": username, "email": "x"}

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", _resolve)


def _album(
    root: Path, name: str, *, artist: str | None = None, track_count: int = 0
) -> int:
    from crate.db.tx import transaction_scope

    artist_name = artist or f"Artist {uuid.uuid4().hex[:8]}"
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists (name, entity_uid) "
                "VALUES (:name, CAST(:uid AS uuid)) ON CONFLICT (name) DO NOTHING"
            ),
            {"name": artist_name, "uid": str(uuid.uuid4())},
        )
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO library_albums (
                        artist, name, path, entity_uid, has_cover, track_count
                    )
                    VALUES (
                        :artist, :name, :path, CAST(:uid AS uuid), 1, :track_count
                    )
                    RETURNING id
                    """
                ),
                {
                    "artist": artist_name,
                    "name": name,
                    "path": str(root / uuid.uuid4().hex),
                    "uid": str(uuid.uuid4()),
                    "track_count": track_count,
                },
            ).scalar_one()
        )


def _track(
    root: Path,
    album_id: int,
    title: str,
    *,
    disc: int = 1,
    number: int = 1,
    with_file: bool = False,
    size: int = 1000,
) -> dict:
    from crate.db.tx import transaction_scope

    path = root / f"{uuid.uuid4().hex}.flac"
    if with_file:
        path.write_bytes(b"fLaC" + b"\0" * 60)
    entity_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path, entity_uid,
                    duration, disc_number, track_number, format, bitrate,
                    sample_rate, bit_depth, size, bpm, genre
                )
                SELECT a.id, a.artist, a.name, :filename, :title, :path,
                       CAST(:uid AS uuid), 245.5, :disc, :number, 'flac', 1411,
                       44100, 16, :size, 121.0, 'Techno'
                FROM library_albums a WHERE a.id = :album_id
                RETURNING id
                """
            ),
            {
                "album_id": album_id,
                "filename": path.name,
                "title": title,
                "path": str(path),
                "uid": entity_uid,
                "disc": disc,
                "number": number,
                "size": size,
            },
        ).scalar_one()
    return {"id": int(row), "entity_uid": entity_uid, "path": path, "title": title}


def _profile(track_id: int, *, analyzer_version: str | None = None) -> None:
    from crate.db.tx import transaction_scope
    from crate.smart_mix.versions import ANALYZER_VERSION

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, bpm,
                    key_camelot, global_energy, analyzed_at
                ) VALUES (
                    :track_id, 1, :revision, 'crate-python', :analyzer_version,
                    'source-rev', 'full', 124.0, '8A', 0.72, NOW()
                )
                """
            ),
            {
                "track_id": track_id,
                "revision": f"profile-{track_id}",
                "analyzer_version": analyzer_version or ANALYZER_VERSION,
            },
        )


def _global_album() -> str:
    from crate.db.tx import transaction_scope

    artist_uid, album_uid = str(uuid.uuid4()), str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists (
                    global_artist_uid, canonical_name, sort_name, normalized_name
                ) VALUES (:uid, :name, :name, :name)
                """
            ),
            {"uid": artist_uid, "name": f"Artist {artist_uid[:8]}"},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums (
                    global_album_uid, global_artist_uid, canonical_name,
                    normalized_name, artist_name
                ) VALUES (:uid, :artist_uid, 'Album', 'album', 'Artist')
                """
            ),
            {"uid": album_uid, "artist_uid": artist_uid},
        )
    return album_uid


def _global_track(
    album_uid: str,
    *,
    local: dict | None,
    disc: int = 1,
    number: int = 1,
) -> str:
    from crate.db.tx import transaction_scope

    track_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks (
                    global_track_uid, global_album_uid, global_artist_uid,
                    canonical_title, normalized_title, artist_name, album_name,
                    disc_number, track_number, duration_seconds, has_local,
                    has_remote, local_track_id, local_track_entity_uid
                )
                SELECT CAST(:track_uid AS uuid), album.global_album_uid,
                       album.global_artist_uid, 'Global', 'global', 'Artist',
                       'Album', :disc, :number, 180, :has_local, NOT :has_local,
                       :local_id, CAST(:local_uid AS uuid)
                FROM global_catalog_albums album
                WHERE album.global_album_uid = CAST(:album_uid AS uuid)
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "disc": disc,
                "number": number,
                "has_local": local is not None,
                "local_id": local["id"] if local else None,
                "local_uid": local["entity_uid"] if local else None,
            },
        )
    return track_uid


def _playlist(name: str, owner: int | None, *, tracks=(), **kwargs) -> int:
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_tracks import add_playlist_tracks

    playlist_id = create_playlist(name=name, user_id=owner, **kwargs)
    if tracks:
        add_playlist_tracks(playlist_id, [{"track_id": t["id"]} for t in tracks])
    return playlist_id


def _crate_member(crate_id: str, user_id: int, invited_by: int) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO crate_members (crate_id, user_id, invited_by) "
                "VALUES (CAST(:crate_id AS uuid), :user_id, :invited_by)"
            ),
            {"crate_id": crate_id, "user_id": user_id, "invited_by": invited_by},
        )


def _follow_playlist(user_id: int, playlist_id: int) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at) "
                "VALUES (:user_id, :playlist_id, NOW())"
            ),
            {"user_id": user_id, "playlist_id": playlist_id},
        )


def _follow_crate(user_id: int, crate_id: str) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO crate_followers (crate_id, user_id) "
                "VALUES (CAST(:crate_id AS uuid), :user_id)"
            ),
            {"crate_id": crate_id, "user_id": user_id},
        )


def _genre(name: str) -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    "INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"
                ),
                {"name": name, "slug": f"{name.lower()}-{uuid.uuid4().hex[:8]}"},
            ).scalar_one()
        )


def _tag_album(album_id: int, *genre_ids: int) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        for genre_id in genre_ids:
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id) "
                    "VALUES (:album_id, :genre_id)"
                ),
                {"album_id": album_id, "genre_id": genre_id},
            )


def _moods(track: dict, scores: dict) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET mood_json = CAST(:scores AS jsonb) "
                "WHERE id = :track_id"
            ),
            {"scores": json.dumps(scores), "track_id": track["id"]},
        )


def _play(
    user_id: int,
    ended_at: datetime,
    *,
    track: dict | None = None,
    entity_uid: str | None = None,
) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id, track_id, track_entity_uid, started_at, ended_at,
                    created_at
                ) VALUES (
                    :user_id, :track_id, CAST(:entity_uid AS uuid),
                    :ended_at - INTERVAL '3 minutes', :ended_at, :ended_at
                )
                """
            ),
            {
                "user_id": user_id,
                "track_id": track["id"] if track else None,
                "entity_uid": (entity_uid or (track["entity_uid"] if track else None)),
                "ended_at": ended_at,
            },
        )


def _like(user_id: int, track: dict, at: datetime) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_liked_tracks (user_id, track_id, created_at) "
                "VALUES (:user_id, :track_id, :at)"
            ),
            {"user_id": user_id, "track_id": track["id"], "at": at},
        )


@pytest.fixture
def library(tmp_path: Path):
    root = tmp_path / "music"
    root.mkdir()
    with patch("crate.streaming.service.library_path", return_value=root):
        yield root


def _titles(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [track["title"] for track in response.json()["tracks"]]


def _pages(test_app, url: str, *, limit: int) -> list[list[str]]:
    pages, cursor = [], None
    while True:
        params = {"limit": limit, **({"cursor": cursor} if cursor else {})}
        response = test_app.get(url, params=params)
        pages.append(_titles(response))
        cursor = response.json()["next_cursor"]
        if cursor is None:
            return pages


# ── Tree ─────────────────────────────────────────────────────────


def test_containers_tree_for_user(pg_db, test_app, monkeypatch, library):
    from crate.db.repositories.crates import create_crate
    from crate.db.repositories.playlists_collaboration import add_playlist_collaborator

    me, friend = _user("tree-me"), _user("tree-friend")
    album = _album(library, "Tree")
    one, two = _track(library, album, "One"), _track(library, album, "Two")
    mine = _playlist("Warm-up", me, tracks=[one, two])
    shared = _playlist("B-sides", friend)
    add_playlist_collaborator(shared, me, added_by=friend)
    followed = _playlist("Followed", friend, visibility="public")
    _follow_playlist(me, followed)
    curated = _playlist("Curated", None, scope="system", visibility="public")
    _follow_playlist(me, curated)
    went_private = _playlist("Went private", friend)
    _follow_playlist(me, went_private)
    _playlist("Friend only", friend)
    _playlist("Friend public", friend, visibility="public")
    _playlist("Archived", me, is_active=False)
    my_crate = create_crate(owner_id=me, name="Digging")
    shared_crate = create_crate(
        owner_id=friend, name="Shared crate", is_collaborative=True
    )
    _crate_member(shared_crate, me, friend)
    followed_crate = create_crate(
        owner_id=friend, name="Followed crate", visibility="public"
    )
    _follow_crate(me, followed_crate)
    create_crate(owner_id=friend, name="Friend crate")
    create_crate(owner_id=friend, name="Friend public crate", visibility="public")
    techno, house = _genre("Techno"), _genre("House")
    _tag_album(_album(library, "T1", track_count=3), techno)
    _tag_album(_album(library, "T2", track_count=2), techno)
    _tag_album(_album(library, "H1", track_count=4), house)

    _act_as(monkeypatch, me)
    response = test_app.get("/api/decks/containers")

    assert response.status_code == 200
    assert response.headers["etag"]
    nodes = response.json()["containers"]
    assert [(n["kind"], n["id"], n["name"]) for n in nodes] == [
        ("playlist", str(shared), "B-sides"),
        ("playlist", str(curated), "Curated"),
        ("playlist", str(followed), "Followed"),
        ("playlist", str(mine), "Warm-up"),
        ("crate", my_crate, "Digging"),
        ("crate", followed_crate, "Followed crate"),
        ("crate", shared_crate, "Shared crate"),
        # Genres keep their rank: most albums first.
        ("genre", str(techno), "Techno"),
        ("genre", str(house), "House"),
        *_MOOD_NODES,
        ("recent", "me", "Recently Played"),
        ("likes", "me", "Likes"),
    ]
    by_key = {(n["kind"], n["id"]): n for n in nodes}
    # track_count only where it is precomputed: playlists.track_count and the
    # genre's albums (library_albums.track_count).
    assert by_key[("playlist", str(mine))]["track_count"] == 2
    assert by_key[("playlist", str(shared))]["track_count"] == 0
    assert by_key[("genre", str(techno))]["track_count"] == 5
    assert by_key[("genre", str(house))]["track_count"] == 4
    for kind, container_id in (
        ("crate", my_crate),
        ("mood", "party"),
        ("recent", "me"),
        ("likes", "me"),
    ):
        assert "track_count" not in by_key[(kind, container_id)]
    assert all(n["parent_id"] is None for n in nodes)
    assert all(isinstance(n["etag"], str) and n["etag"] for n in nodes)


def test_genre_nodes_are_capped_to_the_top_genres(
    pg_db, test_app, monkeypatch, library
):
    me = _user("top-genres")
    common, rare = _genre("Common"), _genre("Rare")
    for name in ("C1", "C2"):
        _tag_album(_album(library, name), common)
    _tag_album(_album(library, "R1"), rare)
    monkeypatch.setattr("crate.db.queries.decks_library.DECKS_GENRE_LIMIT", 1)
    _act_as(monkeypatch, me)

    nodes = test_app.get("/api/decks/containers").json()["containers"]

    assert [n["name"] for n in nodes if n["kind"] == "genre"] == ["Common"]


def test_node_etag_changes_when_the_container_changes(
    pg_db, test_app, monkeypatch, library
):
    from crate.db.repositories.playlists_tracks import add_playlist_tracks

    me = _user("node-etag")
    album = _album(library, "Node etag")
    first, second = _track(library, album, "First"), _track(library, album, "Second")
    playlist_id = _playlist("Changing", me, tracks=[first])
    untouched = _playlist("Untouched", me, tracks=[first])
    _act_as(monkeypatch, me)

    def etags() -> dict[tuple[str, str], str]:
        nodes = test_app.get("/api/decks/containers").json()["containers"]
        return {(n["kind"], n["id"]): n["etag"] for n in nodes}

    before = etags()
    add_playlist_tracks(playlist_id, [{"track_id": second["id"]}])
    now = datetime.now(timezone.utc)
    _play(me, now, track=first)
    _like(me, second, now)
    after = etags()

    assert (
        after[("playlist", str(playlist_id))] != before[("playlist", str(playlist_id))]
    )
    assert after[("recent", "me")] != before[("recent", "me")]
    assert after[("likes", "me")] != before[("likes", "me")]
    assert after[("playlist", str(untouched))] == before[("playlist", str(untouched))]
    assert after[("mood", "party")] == before[("mood", "party")]


# ── Tracks ───────────────────────────────────────────────────────


def test_playlist_tracks_paginated_by_cursor(pg_db, test_app, monkeypatch, library):
    from crate.db.repositories.playlists_tracks import add_playlist_tracks
    from crate.db.tx import transaction_scope

    me = _user("pages")
    album = _album(library, "Pages")
    tracks = [_track(library, album, f"T{n}", number=n) for n in range(1, 6)]
    playlist_id = _playlist("Pages", me, tracks=tracks[:3])
    # An entry whose library track is gone: it has no audio for Decks.
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks (playlist_id, title, position, added_at)
                VALUES (:id, 'Deleted', 4, NOW())
                """
            ),
            {"id": playlist_id},
        )
    add_playlist_tracks(playlist_id, [{"track_id": t["id"]} for t in tracks[3:]])
    _act_as(monkeypatch, me)
    url = f"/api/decks/containers/playlist/{playlist_id}/tracks"

    first = test_app.get(url, params={"limit": 2})
    assert _titles(first) == ["T1", "T2"]
    second = test_app.get(
        url, params={"limit": 2, "cursor": first.json()["next_cursor"]}
    )
    assert _titles(second) == ["T3", "T4"]

    # Appending while a client pages must neither repeat nor skip rows.
    late = _track(library, album, "T6", number=6)
    add_playlist_tracks(playlist_id, [{"track_id": late["id"]}])
    third = test_app.get(
        url, params={"limit": 2, "cursor": second.json()["next_cursor"]}
    )

    assert _titles(third) == ["T5", "T6"]
    assert third.json()["next_cursor"] is None
    assert third.json()["container"] == {"kind": "playlist", "id": str(playlist_id)}
    assert _titles(test_app.get(url)) == ["T1", "T2", "T3", "T4", "T5", "T6"]


def test_track_carries_the_dj_fields(pg_db, test_app, monkeypatch, library):
    from crate.smart_mix.source import smart_mix_source_revision

    me = _user("fields")
    album = _album(library, "Fields", artist="Fields Artist")
    analysed = _track(library, album, "Analysed", with_file=True, size=999)
    bare = _track(library, album, "Bare", size=999)
    _profile(analysed["id"])
    playlist_id = _playlist("Fields", me, tracks=[analysed, bare])
    _act_as(monkeypatch, me)

    response = test_app.get(f"/api/decks/containers/playlist/{playlist_id}/tracks")

    full, missing = response.json()["tracks"]
    assert full == {
        "entity_uid": analysed["entity_uid"],
        "global_track_uid": None,
        "title": "Analysed",
        "artist": "Fields Artist",
        "album": "Fields",
        "duration_ms": 245500,
        "bpm": 124.0,
        "camelot": "8A",
        "energy": 0.72,
        "genre": "Techno",
        "format": "flac",
        "bitrate": 1411,
        "sample_rate": 44100,
        "bit_depth": 16,
        # The size of the file the stream endpoints serve, not the scanner's.
        "byte_length": 64,
        "source_revision": smart_mix_source_revision(analysed["path"]),
        "profile_revision": f"profile-{analysed['id']}",
        "profile_quality": "full",
        "playable": True,
        "cover_url": f"/api/vdj/albums/{album}/cover?size=512",
    }
    assert missing["playable"] is False
    assert missing["source_revision"] is None
    assert missing["byte_length"] == 999
    assert missing["profile_quality"] is None
    assert missing["camelot"] is None
    assert missing["bpm"] == 121.0
    assert "path" not in missing


def test_audio_check_reads_the_library_root_once_per_page(
    pg_db, test_app, monkeypatch, library
):
    # library_path() parses config.yaml on every call (about 2.5 ms): a
    # 500-track page must not pay that per track.
    me = _user("root-once")
    album = _album(library, "Root once")
    tracks = [_track(library, album, f"R{n}", with_file=True) for n in range(3)]
    playlist_id = _playlist("Root once", me, tracks=tracks)
    _act_as(monkeypatch, me)

    with patch("crate.streaming.service.library_path", return_value=library) as root:
        response = test_app.get(f"/api/decks/containers/playlist/{playlist_id}/tracks")

    assert [t["playable"] for t in response.json()["tracks"]] == [True, True, True]
    assert root.call_count == 1


def test_profile_is_the_one_the_mix_profile_endpoint_serves(
    pg_db, test_app, monkeypatch, library
):
    from crate.db.tx import transaction_scope

    me = _user("profile-rule")
    album = _album(library, "Profiles")
    older = _track(library, album, "Older analyzer")
    stale = _track(library, album, "Stale source")
    _profile(older["id"], analyzer_version="smart-mix-audio-v1")
    _profile(stale["id"])
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE track_mix_profiles SET source_stale_at = NOW() "
                "WHERE track_id = :track_id"
            ),
            {"track_id": stale["id"]},
        )
    playlist_id = _playlist("Profiles", me, tracks=[older, stale])
    _act_as(monkeypatch, me)

    older_row, stale_row = test_app.get(
        f"/api/decks/containers/playlist/{playlist_id}/tracks"
    ).json()["tracks"]

    # Decks imports the profile from the per-track endpoint; S3 must announce
    # the same one, whatever analyzer wrote it, and none when it is stale.
    served = test_app.get(f"/api/tracks/by-entity/{older['entity_uid']}/mix-profile")
    assert served.status_code == 200
    assert older_row["profile_revision"] == served.json()["profileRevision"]
    assert older_row["profile_quality"] == "full"
    assert older_row["camelot"] == "8A"
    missing = test_app.get(f"/api/tracks/by-entity/{stale['entity_uid']}/mix-profile")
    assert missing.status_code == 404
    assert stale_row["profile_revision"] is None
    assert stale_row["profile_quality"] is None
    assert stale_row["camelot"] is None


def test_crate_expands_albums_in_disc_track_order(
    pg_db, test_app, monkeypatch, library
):
    from crate.db.repositories.crates import add_crate_album, create_crate, update_crate

    me = _user("crate-order")
    local_album = _album(library, "Crate local")
    first_album, second_album, remote_album = (
        _global_album(),
        _global_album(),
        _global_album(),
    )
    # Inserted out of order on purpose.
    for title, disc, number in (("A2-1", 2, 1), ("A1-2", 1, 2), ("A1-1", 1, 1)):
        local = _track(library, local_album, title, disc=disc, number=number)
        _global_track(first_album, local=local, disc=disc, number=number)
    _global_track(
        second_album, local=_track(library, local_album, "B1-1"), disc=1, number=1
    )
    _global_track(remote_album, local=None)
    crate_id = create_crate(owner_id=me, name="Order")
    for album_uid in (first_album, second_album, remote_album):
        add_crate_album(crate_id, album_uid, added_by=me)
    _act_as(monkeypatch, me)
    url = f"/api/decks/containers/crate/{crate_id}/tracks"

    assert _titles(test_app.get(url)) == ["A1-1", "A1-2", "A2-1", "B1-1"]
    assert _pages(test_app, url, limit=2) == [["A1-1", "A1-2"], ["A2-1", "B1-1"]]

    assert update_crate(crate_id, sort_direction="desc", actor_id=me)
    assert _titles(test_app.get(url)) == ["B1-1", "A1-1", "A1-2", "A2-1"]


def test_genre_tracks_follow_album_disc_and_track_order(
    pg_db, test_app, monkeypatch, library
):
    me = _user("genre-order")
    techno, house = _genre("Techno"), _genre("House")
    first, second, other = (
        _album(library, "First"),
        _album(library, "Second"),
        _album(library, "Other"),
    )
    # Inserted out of order on purpose.
    for title, disc, number in (("F2-1", 2, 1), ("F1-2", 1, 2), ("F1-1", 1, 1)):
        _track(library, first, title, disc=disc, number=number)
    _track(library, second, "S1-1")
    _track(library, other, "H1")
    _tag_album(first, techno)
    _tag_album(second, techno, house)
    _tag_album(other, house)
    _act_as(monkeypatch, me)
    url = f"/api/decks/containers/genre/{techno}/tracks"

    assert _titles(test_app.get(url)) == ["F1-1", "F1-2", "F2-1", "S1-1"]
    assert _pages(test_app, url, limit=2) == [["F1-1", "F1-2"], ["F2-1", "S1-1"]]
    assert _pages(test_app, url, limit=1) == [["F1-1"], ["F1-2"], ["F2-1"], ["S1-1"]]
    assert _titles(test_app.get(f"/api/decks/containers/genre/{house}/tracks")) == [
        "S1-1",
        "H1",
    ]


def test_mood_tracks_by_score(pg_db, test_app, monkeypatch, library):
    me = _user("mood-order")
    album = _album(library, "Moods")
    scores = {
        "Peak": {"party": 0.9},
        "Tie first": {"party": 0.7},
        "Tie second": {"party": 0.7, "dark": 0.95},
        "Threshold": {"party": 0.5},
        "Below": {"party": 0.49},
        "Other mood": {"dark": 0.8},
        "Not a number": {"party": "high"},
    }
    for title, mood_scores in scores.items():
        _moods(_track(library, album, title), mood_scores)
    _track(library, album, "Unanalysed")
    _act_as(monkeypatch, me)
    url = "/api/decks/containers/mood/party/tracks"

    assert _titles(test_app.get(url)) == [
        "Peak",
        "Tie first",
        "Tie second",
        "Threshold",
    ]
    assert _pages(test_app, url, limit=2) == [
        ["Peak", "Tie first"],
        ["Tie second", "Threshold"],
    ]
    assert _pages(test_app, url, limit=1) == [
        ["Peak"],
        ["Tie first"],
        ["Tie second"],
        ["Threshold"],
    ]
    assert _titles(test_app.get("/api/decks/containers/mood/dark/tracks")) == [
        "Tie second",
        "Other mood",
    ]


def test_recent_tracks_newest_first(pg_db, test_app, monkeypatch, library):
    from crate.db.tx import transaction_scope

    me, friend = _user("recent"), _user("recent-friend")
    album = _album(library, "Recent")
    again, once, rescanned = (
        _track(library, album, "Played twice"),
        _track(library, album, "Played once"),
        _track(library, album, "Rescanned"),
    )
    now = datetime.now(timezone.utc)
    _play(me, now - timedelta(hours=3), track=again)
    _play(me, now - timedelta(hours=2), track=once)
    _play(me, now - timedelta(hours=1), track=again)
    # A play whose track row is gone but whose entity is in the library again.
    _play(me, now - timedelta(minutes=90), entity_uid=rescanned["entity_uid"])
    # A remote-only play has no local track and is left out.
    _play(me, now - timedelta(minutes=30), entity_uid=str(uuid.uuid4()))
    _play(friend, now, track=once)
    with transaction_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM user_play_events "
                    "WHERE user_id = :user_id AND track_id IS NULL"
                ),
                {"user_id": me},
            ).scalar_one()
            == 2
        )
    _act_as(monkeypatch, me)
    url = "/api/decks/containers/recent/me/tracks"

    assert _titles(test_app.get(url)) == ["Played twice", "Rescanned", "Played once"]
    assert _pages(test_app, url, limit=2) == [
        ["Played twice", "Rescanned"],
        ["Played once"],
    ]


def test_likes_list_local_tracks_newest_first(pg_db, test_app, monkeypatch, library):
    from crate.db.tx import transaction_scope

    me = _user("likes")
    album = _album(library, "Likes")
    old, new, legacy = (
        _track(library, album, "Old like"),
        _track(library, album, "New like"),
        _track(library, album, "Legacy like"),
    )
    global_album = _global_album()
    old_uid = _global_track(global_album, local=old)
    new_uid = _global_track(global_album, local=new)
    remote_uid = _global_track(global_album, local=None)
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        for uid, age in ((old_uid, 3), (new_uid, 1), (remote_uid, 0)):
            session.execute(
                text(
                    "INSERT INTO user_global_track_likes (user_id, global_track_uid, created_at) "
                    "VALUES (:user_id, CAST(:uid AS uuid), :at)"
                ),
                {"user_id": me, "uid": uid, "at": now - timedelta(days=age)},
            )
    _like(me, legacy, now - timedelta(days=2))
    _act_as(monkeypatch, me)
    url = "/api/decks/containers/likes/me/tracks"

    assert _titles(test_app.get(url)) == ["New like", "Legacy like", "Old like"]
    assert _pages(test_app, url, limit=2) == [["New like", "Legacy like"], ["Old like"]]


# ── Conditional requests ─────────────────────────────────────────


def test_etag_not_modified(pg_db, test_app, monkeypatch, library):
    from crate.db.repositories.playlists_tracks import add_playlist_tracks

    me = _user("etag")
    album = _album(library, "Etag")
    first, second = _track(library, album, "First"), _track(library, album, "Second")
    playlist_id = _playlist("Etag", me, tracks=[first])
    _act_as(monkeypatch, me)

    for url, change in (
        (
            f"/api/decks/containers/playlist/{playlist_id}/tracks",
            lambda: add_playlist_tracks(playlist_id, [{"track_id": second["id"]}]),
        ),
        ("/api/decks/containers", lambda: _playlist("Another", me)),
    ):
        fresh = test_app.get(url)
        etag = fresh.headers["etag"]
        assert fresh.status_code == 200
        assert fresh.headers["cache-control"] == "private, no-cache"

        cached = test_app.get(url, headers={"If-None-Match": etag})
        assert cached.status_code == 304
        assert cached.content == b""
        assert cached.headers["etag"] == etag

        listed = test_app.get(url, headers={"If-None-Match": f'"other", W/{etag}'})
        assert listed.status_code == 304

        change()
        changed = test_app.get(url, headers={"If-None-Match": etag})
        assert changed.status_code == 200
        assert changed.headers["etag"] != etag


# ── Access ───────────────────────────────────────────────────────


async def _access_token_user(_middleware, _request):
    return {
        "id": 7,
        "email": "vdj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.catalog.read", "vdj.smart_mix.read"],
    }


@pytest.mark.parametrize(
    "url", ["/api/decks/containers", "/api/decks/containers/likes/me/tracks"]
)
def test_access_token_rejected(test_app, url):
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _access_token_user):
        # The middleware never lets a crv_ token reach Decks routes...
        assert test_app.get(url).status_code == 401
        # ...and the handlers refuse one even if a future allow-list did.
        with patch("crate.api.auth._is_access_token_request", return_value=True):
            assert test_app.get(url).status_code == 403


def test_trusted_header_user_without_account_rejected(test_app):
    async def _remote_user(_middleware, _request):
        return {"id": None, "email": "proxy@example.test", "role": "user"}

    with patch("crate.api.auth.AuthMiddleware.resolve_user", _remote_user):
        assert test_app.get("/api/decks/containers").status_code == 403


def test_other_users_private_playlist_forbidden(pg_db, test_app, monkeypatch, library):
    from crate.db.repositories.crates import create_crate

    me, friend = _user("nosy"), _user("private-owner")
    private_playlist = _playlist("Private", friend)
    public_playlist = _playlist("Public", friend, visibility="public")
    curated = _playlist("Curated", None, scope="system", visibility="public")
    archived = _playlist("Archived", me, is_active=False)
    private_crate = create_crate(owner_id=friend, name="Private crate")
    public_crate = create_crate(
        owner_id=friend, name="Public crate", visibility="public"
    )
    genre = _genre("Ambient")
    _act_as(monkeypatch, me)

    def status(kind: str, container_id: object) -> int:
        return test_app.get(
            f"/api/decks/containers/{kind}/{container_id}/tracks"
        ).status_code

    assert status("playlist", private_playlist) == 403
    assert status("crate", private_crate) == 403
    assert status("playlist", public_playlist) == 200
    assert status("playlist", curated) == 200
    assert status("crate", public_crate) == 200
    assert status("genre", genre) == 200
    assert status("mood", "party") == 200
    assert status("recent", "me") == 200
    assert status("likes", "me") == 200
    assert status("playlist", archived) == 404
    assert status("playlist", 987654321) == 404
    assert status("playlist", "not-a-number") == 404
    assert status("crate", "not-a-uuid") == 404
    assert status("crate", uuid.uuid4()) == 404
    assert status("genre", 987654321) == 404
    assert status("genre", "techno") == 404
    assert status("mood", "chill") == 404
    assert status("recent", friend) == 404
    assert status("likes", friend) == 404
    assert status("folder", "me") == 422


# ── Cursor validation ────────────────────────────────────────────


def test_cursor_is_opaque_and_bound_to_its_container(
    pg_db, test_app, monkeypatch, library
):
    me = _user("cursor")
    album = _album(library, "Cursor")
    tracks = [_track(library, album, f"C{n}") for n in range(3)]
    for track in tracks:
        _moods(track, {"party": 0.8, "happy": 0.8})
    first = _playlist("First", me, tracks=tracks)
    second = _playlist("Second", me, tracks=tracks)
    _act_as(monkeypatch, me)

    cursor = test_app.get(
        f"/api/decks/containers/playlist/{first}/tracks", params={"limit": 1}
    ).json()["next_cursor"]
    assert cursor and "=" not in cursor
    json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
    mood_cursor = test_app.get(
        "/api/decks/containers/mood/party/tracks", params={"limit": 1}
    ).json()["next_cursor"]
    assert mood_cursor

    for url, bad in (
        (f"/api/decks/containers/playlist/{second}/tracks", cursor),
        (f"/api/decks/containers/playlist/{second}/tracks", "not-base64!"),
        (
            f"/api/decks/containers/playlist/{second}/tracks",
            base64.urlsafe_b64encode(b"[1,2]").decode(),
        ),
        ("/api/decks/containers/mood/happy/tracks", mood_cursor),
        ("/api/decks/containers/recent/me/tracks", cursor),
    ):
        response = test_app.get(url, params={"cursor": bad})
        assert response.status_code == 400, (url, bad)


def test_limit_is_bounded(test_app):
    url = "/api/decks/containers/likes/me/tracks"
    assert test_app.get(url, params={"limit": 501}).status_code == 422
    assert test_app.get(url, params={"limit": 0}).status_code == 422
