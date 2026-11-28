"""AA3: device browse, search and queue API (`/api/me/device/*`).

End to end through the real auth middleware, with an interactive session and
with a native device token minted from it (AA2).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text

from crate.api.auth import AuthMiddleware
from tests.conftest import PG_AVAILABLE
from tests.sql_statements import recorded_statements

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

_REAL_RESOLVE_USER = AuthMiddleware.resolve_user
_NOW = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)


# ── Client and credentials ───────────────────────────────────────


@pytest.fixture
def client(pg_db, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from crate.api import auth_cache

    del pg_db
    monkeypatch.setattr(AuthMiddleware, "resolve_user", _REAL_RESOLVE_USER)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: None,
    )
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "false")
    auth_cache._session_cache.clear()
    auth_cache._user_cache.clear()
    config = {"library_path": str(tmp_path), "audio_extensions": [], "exclude_dirs": []}
    with (
        patch("crate.api._deps.load_config", return_value=config),
        patch("crate.api.cache_events.broadcast_invalidation"),
    ):
        from crate.api import create_app

        with TestClient(create_app()) as test_client:
            yield test_client


@pytest.fixture
def listener(client):
    """A signed-in user: (user, session headers, device token headers)."""
    user, headers = _signed_in(f"car-{uuid.uuid4().hex[:10]}@test.com")
    minted = client.post(
        "/api/auth/device-tokens",
        json={"device_id": f"android-{uuid.uuid4().hex[:12]}", "label": "Android: DHU"},
        headers=headers,
    )
    assert minted.status_code == 201, minted.text
    return user, headers, {"Authorization": f"Bearer {minted.json()['token']}"}


def _signed_in(email: str) -> tuple[dict, dict]:
    from crate.auth import create_jwt
    from crate.db.repositories.auth_sessions import create_session
    from crate.db.repositories.auth_user_accounts import create_user

    user = create_user(email, password_hash=None)
    session_id = f"session-{uuid.uuid4()}"
    create_session(
        session_id, user["id"], datetime.now(timezone.utc) + timedelta(days=30)
    )
    token = create_jwt(user["id"], email, "user", session_id=session_id)
    return user, {"Authorization": f"Bearer {token}"}


def _both(listener):
    _, session, device = listener
    return (("session", session), ("device", device))


# ── Seeding ──────────────────────────────────────────────────────


def _exec(sql: str, params: dict | None = None):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        result = session.execute(text(sql), params or {})
        return result.mappings().all() if result.returns_rows else None


def _artist(name: str | None = None, *, has_photo: int = 1) -> dict:
    name = name or f"Artist {uuid.uuid4().hex[:8]}"
    row = _exec(
        "INSERT INTO library_artists (name, entity_uid, has_photo) "
        "VALUES (:name, CAST(:uid AS uuid), :has_photo) "
        "RETURNING id, entity_uid::text AS entity_uid, name",
        {"name": name, "uid": str(uuid.uuid4()), "has_photo": has_photo},
    )[0]
    return dict(row)


def _album(artist: dict, name: str, *, year: str = "2020", has_cover: int = 1) -> dict:
    row = _exec(
        """
        INSERT INTO library_albums (artist, name, path, entity_uid, has_cover, year)
        VALUES (:artist, :name, :path, CAST(:uid AS uuid), :has_cover, :year)
        RETURNING id, entity_uid::text AS entity_uid, name
        """,
        {
            "artist": artist["name"],
            "name": name,
            "path": f"/music/{uuid.uuid4().hex}",
            "uid": str(uuid.uuid4()),
            "has_cover": has_cover,
            "year": year,
        },
    )[0]
    return dict(row)


def _tracks(album: dict, count: int, *, disc: int = 1, prefix: str = "T") -> list[dict]:
    """`count` tracks numbered 1..count in one statement."""
    rows = _exec(
        """
        INSERT INTO library_tracks (
            album_id, artist, album, filename, title, path, entity_uid,
            duration, disc_number, track_number, format
        )
        SELECT a.id, a.artist, a.name, 'f' || n || '.flac', :prefix || n,
               a.path || '/' || :disc || '-' || n || '.flac',
               gen_random_uuid(), 200 + n, :disc, n, 'flac'
        FROM library_albums a, generate_series(1, :count) AS n
        WHERE a.id = :album_id
        RETURNING id, entity_uid::text AS entity_uid, title, track_number
        """,
        {"album_id": album["id"], "count": count, "disc": disc, "prefix": prefix},
    )
    return sorted((dict(row) for row in rows), key=lambda row: row["track_number"])


def _like(user_id: int, track: dict, at: datetime) -> None:
    _exec(
        "INSERT INTO user_liked_tracks (user_id, track_id, created_at) "
        "VALUES (:user_id, :track_id, :at)",
        {"user_id": user_id, "track_id": track["id"], "at": at},
    )


def _save_album(user_id: int, album: dict, at: datetime) -> None:
    _exec(
        "INSERT INTO user_saved_albums (user_id, album_id, created_at) "
        "VALUES (:user_id, :album_id, :at)",
        {"user_id": user_id, "album_id": album["id"], "at": at},
    )


def _follow(user_id: int, artist: dict, at: datetime) -> None:
    _exec(
        "INSERT INTO user_follows (user_id, artist_name, created_at) "
        "VALUES (:user_id, :name, :at)",
        {"user_id": user_id, "name": artist["name"], "at": at},
    )


def _playlist(name: str, owner: int, tracks=(), **kwargs) -> int:
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_tracks import add_playlist_tracks

    playlist_id = create_playlist(name=name, user_id=owner, **kwargs)
    if tracks:
        add_playlist_tracks(playlist_id, [{"track_id": t["id"]} for t in tracks])
    return playlist_id


def _home_snapshot(user_id: int, payload: dict) -> None:
    from crate.db.ui_snapshot_writes import upsert_ui_snapshot

    upsert_ui_snapshot(
        "home:discovery",
        str(user_id),
        payload,
        stale_after_seconds=600,
        publish_snapshot=lambda *args: None,
    )


def _browse(client, headers, node: str, **params):
    return client.get(f"/api/me/device/browse/{node}", params=params, headers=headers)


def _ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def _walk(client, headers, node: str, limit: int) -> list[list[str]]:
    pages, cursor = [], None
    while True:
        params = {"limit": limit, **({"cursor": cursor} if cursor else {})}
        response = _browse(client, headers, node, **params)
        pages.append(_ids(response))
        cursor = response.json()["next_cursor"]
        if not cursor:
            return pages


# ── Root, library and auth ───────────────────────────────────────


def test_root_and_library_are_fixed_folders(client, listener):
    for name, headers in _both(listener):
        root = _browse(client, headers, "root")
        assert root.status_code == 200, (name, root.text)
        assert root.json()["node"] == "root"
        assert root.json()["next_cursor"] is None
        assert root.json()["items"][0] == {
            "id": "home",
            "kind": "folder",
            "title": "Home",
            "subtitle": None,
            "artwork_url": None,
            "playable": False,
            "browsable": True,
        }
        assert _ids(root) == ["home", "library", "radio"]
        assert _ids(_browse(client, headers, "library")) == [
            "recent",
            "playlists",
            "liked",
            "albums",
            "artists",
        ]


def test_device_api_requires_a_session_or_device_token(client):
    assert _browse(client, {}, "root").status_code == 401
    assert client.get("/api/me/device/search", params={"q": "abc"}).status_code == 401
    assert (
        client.post("/api/me/device/queue", json={"node": "liked"}).status_code == 401
    )


def test_unknown_nodes_are_404(client, listener):
    _, headers, _ = listener
    for node in (
        "nope",
        "album:not-a-uuid",
        "playlist:abc",
        "artist:",
        "track:" + str(uuid.uuid4()),
        "mix:daily-discovery",
        "album:" + str(uuid.uuid4()),
        "artist:" + str(uuid.uuid4()),
        "playlist:999999",
    ):
        response = _browse(client, headers, node)
        assert response.status_code == 404, (node, response.text)


def test_device_token_still_refused_outside_its_allowlist(client, listener):
    _, _, device = listener
    for method, path in (
        ("GET", "/api/me/likes"),
        ("GET", "/api/search?q=abc"),
        ("POST", "/api/me/device/browse/root"),
        ("PUT", "/api/me/device/queue"),
        ("DELETE", "/api/me/device/queue"),
    ):
        response = client.request(method, path, headers=device)
        assert response.status_code == 403, (method, path, response.text)
        assert response.json()["detail"] == (
            "This device token cannot be used on this route"
        )


# ── ETags ────────────────────────────────────────────────────────


def test_browse_and_search_answer_304_for_a_matching_etag(client, listener):
    _, session, device = listener
    artist = _artist("Etag Band")
    _tracks(_album(artist, "Etag Record"), 2)
    for headers in (session, device):
        first = _browse(client, headers, "root")
        etag = first.headers["etag"]
        assert first.headers["cache-control"] == "private, no-cache"
        again = client.get(
            "/api/me/device/browse/root",
            headers={**headers, "If-None-Match": etag},
        )
        assert again.status_code == 304
        assert again.headers["etag"] == etag
        assert again.content == b""
        other = client.get(
            "/api/me/device/browse/root",
            headers={**headers, "If-None-Match": '"stale"'},
        )
        assert other.status_code == 200

        search = client.get(
            "/api/me/device/search", params={"q": "Etag"}, headers=headers
        )
        assert search.status_code == 200
        cached = client.get(
            "/api/me/device/search",
            params={"q": "Etag"},
            headers={**headers, "If-None-Match": search.headers["etag"]},
        )
        assert cached.status_code == 304


# ── Home, recent and radio (snapshot) ────────────────────────────


def _home_payload(album: dict, artist: dict, playlist_id: int) -> dict:
    return {
        "custom_mixes": [
            {
                "id": "daily-discovery",
                "name": "Daily Discovery",
                "description": "Fresh picks",
                "artwork_tracks": [{"album_entity_uid": album["entity_uid"]}],
                "kind": "mix",
            },
            {"id": "BAD ID", "name": "Ignored"},
        ],
        "recently_played": [
            {
                "type": "album",
                "album_entity_uid": album["entity_uid"],
                "album_name": album["name"],
                "artist_name": artist["name"],
            },
            {
                "type": "artist",
                "artist_entity_uid": artist["entity_uid"],
                "artist_name": artist["name"],
            },
            {
                "type": "playlist",
                "playlist_id": playlist_id,
                "playlist_name": "Road trip",
                "playlist_tracks": [{"album_entity_uid": album["entity_uid"]}],
            },
            # Federated-only albums have no local entity: skipped.
            {"type": "album", "album_entity_uid": None, "album_name": "Remote"},
        ],
        "radio_stations": [
            {
                "seed_type": "artist",
                "seed_value": str(artist["id"]),
                "title": f"{artist['name']} Radio",
                "artist_entity_uid": artist["entity_uid"],
            },
            {
                "seed_type": "album",
                "seed_value": str(album["id"]),
                "title": f"{album['name']} Radio",
                "album_entity_uid": album["entity_uid"],
                "artist_name": artist["name"],
            },
            {"seed_type": "artist", "seed_value": "global-uid", "title": "Remote"},
        ],
        "suggested_albums": [{"album_entity_uid": album["entity_uid"]}],
        "essentials": [{"id": "essentials-1", "name": "Essentials"}],
    }


def test_home_serves_mixes_recent_and_radio_from_the_snapshot(client, listener):
    user, _, _ = listener
    artist = _artist("Home Band")
    album = _album(artist, "Home Record")
    playlist_id = _playlist("Road trip", user["id"])
    _home_snapshot(user["id"], _home_payload(album, artist, playlist_id))

    for name, headers in _both(listener):
        response = _browse(client, headers, "home")
        assert response.status_code == 200, (name, response.text)
        items = response.json()["items"]
        assert [(item["id"], item["group"]) for item in items] == [
            ("mix:daily-discovery", "Mixes"),
            (f"album:{album['entity_uid']}", "Recently played"),
            (f"artist:{artist['entity_uid']}", "Recently played"),
            (f"playlist:{playlist_id}", "Recently played"),
            (f"station:artist:{artist['id']}", "Radio"),
            (f"station:album:{album['id']}", "Radio"),
        ]
        mix = items[0]
        assert mix["kind"] == "mix"
        assert mix["playable"] is True and mix["browsable"] is False
        assert mix["subtitle"] == "Fresh picks"
        assert mix["artwork_url"] == (
            f"/api/albums/by-entity/{album['entity_uid']}/cover?size=512"
        )
        assert items[2]["artwork_url"] == (
            f"/api/artists/by-entity/{artist['entity_uid']}/photo?size=512"
        )
        assert items[5]["subtitle"] == "Home Band"

        assert _ids(_browse(client, headers, "recent")) == [
            f"album:{album['entity_uid']}",
            f"artist:{artist['entity_uid']}",
            f"playlist:{playlist_id}",
        ]
        assert _ids(_browse(client, headers, "radio")) == [
            f"station:artist:{artist['id']}",
            f"station:album:{album['id']}",
        ]


def test_home_pages_with_an_offset_cursor(client, listener):
    user, headers, _ = listener
    artist = _artist()
    album = _album(artist, "Paged")
    _home_snapshot(user["id"], _home_payload(album, artist, 1))
    pages = _walk(client, headers, "home", limit=4)
    assert [len(page) for page in pages] == [4, 2]
    assert sum(pages, []) == _ids(_browse(client, headers, "home"))


def test_cold_home_never_builds_in_the_request(client, listener, monkeypatch):
    user, headers, device = listener

    def _boom(*args, **kwargs):
        raise AssertionError("home was built in a device request")

    monkeypatch.setattr(
        "crate.db.home_discovery_surface.build_home_discovery_payload", _boom
    )
    for credentials in (headers, device):
        response = _browse(client, credentials, "home")
        assert response.status_code == 200
        assert response.json()["items"] == []
    tasks = _exec(
        "SELECT dedup_key FROM tasks WHERE type = 'refresh_home_discovery_snapshot'"
    )
    assert f"home-discovery:{user['id']}" in {row["dedup_key"] for row in tasks}


def test_stale_home_is_served_and_refreshed_in_the_background(client, listener):
    user, headers, _ = listener
    artist = _artist("Stale Band")
    album = _album(artist, "Stale Record")
    _home_snapshot(user["id"], _home_payload(album, artist, 1))
    _exec(
        "UPDATE ui_snapshots SET built_at = now() - interval '20 minutes' "
        "WHERE scope = 'home:discovery' AND subject_key = :key",
        {"key": str(user["id"])},
    )

    assert _ids(_browse(client, headers, "radio")) == [
        f"station:artist:{artist['id']}",
        f"station:album:{album['id']}",
    ]
    tasks = _exec(
        "SELECT dedup_key FROM tasks WHERE type = 'refresh_home_discovery_snapshot'"
    )
    assert f"home-discovery:{user['id']}" in {row["dedup_key"] for row in tasks}


# ── Albums, artists and playlists ────────────────────────────────


def test_saved_albums_page_with_a_stable_keyset_cursor(client, listener):
    user, _, _ = listener
    artist = _artist()
    albums = [_album(artist, f"Saved {index}") for index in range(5)]
    for index, album in enumerate(albums):
        _save_album(user["id"], album, _NOW - timedelta(hours=index))
    expected = [f"album:{album['entity_uid']}" for album in albums]

    for _, headers in _both(listener):
        pages = _walk(client, headers, "albums", limit=2)
        assert pages == [expected[:2], expected[2:4], expected[4:]]

    # Saving a new album between pages neither repeats nor skips rows.
    _, headers, _ = listener
    first = _browse(client, headers, "albums", limit=2)
    _save_album(user["id"], _album(artist, "Newest"), _NOW + timedelta(hours=1))
    second = _browse(
        client, headers, "albums", limit=2, cursor=first.json()["next_cursor"]
    )
    assert _ids(second) == expected[2:4]


def _global_artist(local: dict | None) -> str:
    uid = str(uuid.uuid4())
    _exec(
        """
        INSERT INTO global_catalog_artists (
            global_artist_uid, canonical_name, sort_name, normalized_name,
            local_artist_id, local_artist_entity_uid
        ) VALUES (CAST(:uid AS uuid), :name, :name, :name, :local_id,
                  CAST(:local_uid AS uuid))
        """,
        {
            "uid": uid,
            "name": local["name"] if local else f"Remote {uid[:8]}",
            "local_id": local["id"] if local else None,
            "local_uid": local["entity_uid"] if local else None,
        },
    )
    return uid


def _global_album(artist_uid: str, local: dict | None) -> str:
    uid = str(uuid.uuid4())
    _exec(
        """
        INSERT INTO global_catalog_albums (
            global_album_uid, global_artist_uid, canonical_name, normalized_name,
            artist_name, local_album_id, local_album_entity_uid
        ) VALUES (CAST(:uid AS uuid), CAST(:artist_uid AS uuid), 'Album', 'album',
                  'Artist', :local_id, CAST(:local_uid AS uuid))
        """,
        {
            "uid": uid,
            "artist_uid": artist_uid,
            "local_id": local["id"] if local else None,
            "local_uid": local["entity_uid"] if local else None,
        },
    )
    return uid


def test_canonical_saves_and_follows_list_only_local_items(client, listener):
    user, headers, device = listener
    local_artist = _artist("Canonical Band")
    local_album = _album(local_artist, "Canonical Record")
    legacy_album = _album(local_artist, "Legacy Record")
    artist_uid = _global_artist(local_artist)
    remote_artist_uid = _global_artist(None)
    album_uid = _global_album(artist_uid, local_album)
    remote_album_uid = _global_album(remote_artist_uid, None)
    _exec(
        """
        INSERT INTO user_global_album_saves (user_id, global_album_uid, created_at)
        VALUES (:user_id, CAST(:local AS uuid), :newer),
               (:user_id, CAST(:remote AS uuid), :newest);
        INSERT INTO user_global_artist_follows (user_id, global_artist_uid, created_at)
        VALUES (:user_id, CAST(:artist AS uuid), :newer),
               (:user_id, CAST(:remote_artist AS uuid), :newest)
        """,
        {
            "user_id": user["id"],
            "local": album_uid,
            "remote": remote_album_uid,
            "artist": artist_uid,
            "remote_artist": remote_artist_uid,
            "newer": _NOW,
            "newest": _NOW + timedelta(hours=1),
        },
    )
    _save_album(user["id"], legacy_album, _NOW - timedelta(days=1))
    # The legacy row of an album that is also saved canonically is listed once.
    _save_album(user["id"], local_album, _NOW - timedelta(days=2))
    _follow(user["id"], local_artist, _NOW - timedelta(days=2))

    for credentials in (headers, device):
        assert _ids(_browse(client, credentials, "albums")) == [
            f"album:{local_album['entity_uid']}",
            f"album:{legacy_album['entity_uid']}",
        ]
        assert _ids(_browse(client, credentials, "artists")) == [
            f"artist:{local_artist['entity_uid']}"
        ]


def test_album_node_lists_tracks_in_disc_order_and_pages(client, listener):
    artist = _artist("Album Band")
    album = _album(artist, "Double")
    disc_two = _tracks(album, 2, disc=2, prefix="B")
    disc_one = _tracks(album, 3, disc=1, prefix="A")
    expected = [f"track:{t['entity_uid']}" for t in (*disc_one, *disc_two)]

    for _, headers in _both(listener):
        response = _browse(client, headers, f"album:{album['entity_uid']}")
        body = response.json()
        assert body["title"] == "Double"
        assert _ids(response) == expected
        first = body["items"][0]
        assert first == {
            "id": expected[0],
            "kind": "track",
            "title": "A1",
            "subtitle": "Album Band",
            "artwork_url": f"/api/albums/by-entity/{album['entity_uid']}/cover?size=512",
            "playable": True,
            "browsable": False,
            "duration_ms": 201000,
        }
        pages = _walk(client, headers, f"album:{album['entity_uid']}", limit=2)
        assert sum(pages, []) == expected
        assert len(pages) == 3

    _, headers, _ = listener
    upper = album["entity_uid"].upper()
    assert _browse(client, headers, f"album:{upper}").json()["node"] == (
        f"album:{album['entity_uid']}"
    )


def test_cursor_from_another_node_is_rejected(client, listener):
    _, headers, _ = listener
    artist = _artist()
    album = _album(artist, "Cursor")
    _tracks(album, 3)
    cursor = _browse(client, headers, f"album:{album['entity_uid']}", limit=1).json()[
        "next_cursor"
    ]
    assert cursor
    for node in ("albums", "liked", "playlists", "home"):
        response = _browse(client, headers, node, cursor=cursor)
        assert response.status_code == 400, node
    assert _browse(client, headers, "albums", cursor="%%%").status_code == 400


def test_followed_artists_and_artist_page(client, listener, monkeypatch):
    user, _, _ = listener
    older, newer = _artist("Older Band"), _artist("Newer Band", has_photo=0)
    _follow(user["id"], older, _NOW - timedelta(days=1))
    _follow(user["id"], newer, _NOW)
    first = _album(older, "First", year="2001")
    second = _album(older, "Second", year="2010")
    top = _tracks(first, 2)
    monkeypatch.setattr(
        "crate.api.device_library._artist_top_tracks",
        lambda name: [
            {
                "track_entity_uid": track["entity_uid"],
                "title": track["title"],
                "artist": name,
                "album_entity_uid": first["entity_uid"],
                "duration": 180,
            }
            for track in top
        ],
    )

    for _, headers in _both(listener):
        artists = _browse(client, headers, "artists").json()["items"]
        assert [item["id"] for item in artists] == [
            f"artist:{newer['entity_uid']}",
            f"artist:{older['entity_uid']}",
        ]
        assert artists[0]["artwork_url"] is None
        assert artists[1]["playable"] and artists[1]["browsable"]

        page = _browse(client, headers, f"artist:{older['entity_uid']}")
        body = page.json()
        assert body["title"] == "Older Band"
        assert [(item["id"], item["group"]) for item in body["items"]] == [
            (f"track:{top[0]['entity_uid']}", "Top tracks"),
            (f"track:{top[1]['entity_uid']}", "Top tracks"),
            (f"album:{second['entity_uid']}", "Albums"),
            (f"album:{first['entity_uid']}", "Albums"),
        ]
        pages = _walk(client, headers, f"artist:{older['entity_uid']}", limit=3)
        assert [len(page) for page in pages] == [3, 1]


def test_playlists_and_playlist_tracks(client, listener):
    user, _, _ = listener
    other, _ = _signed_in(f"other-{uuid.uuid4().hex[:8]}@test.com")
    artist = _artist()
    album = _album(artist, "Mixtape")
    tracks = _tracks(album, 5)
    mine = _playlist("b mine", user["id"], tracks)
    shared_public = _playlist("a public", other["id"], tracks[:1], visibility="public")
    private = _playlist("c private", other["id"], tracks[:2])
    _exec(
        "INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at) "
        "VALUES (:user_id, :public, now()), (:user_id, :private, now())",
        {"user_id": user["id"], "public": shared_public, "private": private},
    )
    expected_tracks = [f"track:{t['entity_uid']}" for t in tracks]

    for _, headers in _both(listener):
        listing = _browse(client, headers, "playlists").json()
        # A followed private playlist of someone else is not listed.
        assert [item["id"] for item in listing["items"]] == [
            f"playlist:{shared_public}",
            f"playlist:{mine}",
        ]
        assert listing["items"][1]["artwork_url"] == (
            f"/api/albums/by-entity/{album['entity_uid']}/cover?size=512"
        )
        pages = _walk(client, headers, "playlists", limit=1)
        assert pages == [[f"playlist:{shared_public}"], [f"playlist:{mine}"]]

        detail = _browse(client, headers, f"playlist:{mine}")
        assert detail.json()["title"] == "b mine"
        assert _ids(detail) == expected_tracks
        assert detail.json()["items"][0]["artwork_url"] == (
            f"/api/albums/{album['id']}/cover?size=512"
        )
        assert sum(_walk(client, headers, f"playlist:{mine}", limit=2), []) == (
            expected_tracks
        )
        assert _browse(client, headers, f"playlist:{private}").status_code == 404
        assert (
            _ids(_browse(client, headers, f"playlist:{shared_public}"))
            == (expected_tracks[:1])
        )


def test_liked_tracks_page_newest_first(client, listener):
    user, _, _ = listener
    artist = _artist()
    tracks = _tracks(_album(artist, "Liked"), 5)
    for index, track in enumerate(tracks):
        _like(user["id"], track, _NOW - timedelta(minutes=index))
    expected = [f"track:{t['entity_uid']}" for t in tracks]

    for _, headers in _both(listener):
        assert _walk(client, headers, "liked", limit=2) == [
            expected[:2],
            expected[2:4],
            expected[4:],
        ]


def test_browse_pages_do_not_grow_queries_with_the_page(client, listener):
    user, headers, _ = listener
    artist = _artist()
    album = _album(artist, "Counted")
    tracks = _tracks(album, 40)
    playlist_id = _playlist("Counted", user["id"], tracks)
    for index, track in enumerate(tracks):
        _like(user["id"], track, _NOW - timedelta(minutes=index))
    for index in range(30):
        _save_album(
            user["id"],
            _album(artist, f"Saved {index}"),
            _NOW - timedelta(minutes=index),
        )

    def statements(node: str, limit: int) -> int:
        with recorded_statements() as recorded:
            assert _browse(client, headers, node, limit=limit).status_code == 200
        return len(recorded)

    for node in (
        "liked",
        "albums",
        f"album:{album['entity_uid']}",
        f"playlist:{playlist_id}",
    ):
        assert statements(node, 2) == statements(node, 40), node


# ── Search ───────────────────────────────────────────────────────


def test_search_returns_local_artists_albums_and_tracks(client, listener):
    artist = _artist("Zebrafinch")
    album = _album(artist, "Zebrafinch Sessions")
    track = _tracks(album, 1, prefix="Zebrafinch song ")[0]

    for _, headers in _both(listener):
        response = client.get(
            "/api/me/device/search", params={"q": "zebrafinch"}, headers=headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["node"] == "search"
        assert body["next_cursor"] is None
        by_id = {item["id"]: item for item in body["items"]}
        assert by_id[f"artist:{artist['entity_uid']}"]["group"] == "Artists"
        assert by_id[f"album:{album['entity_uid']}"]["group"] == "Albums"
        found = by_id[f"track:{track['entity_uid']}"]
        assert found["group"] == "Tracks"
        assert found["playable"] is True


def test_search_requires_two_characters_and_bounds_the_limit(client, listener):
    _, headers, device = listener
    for credentials in (headers, device):
        for params in ({"q": "a"}, {"q": " a "}, {}, {"q": "ab", "limit": 51}):
            response = client.get(
                "/api/me/device/search", params=params, headers=credentials
            )
            assert response.status_code == 422, params


# ── Queue ────────────────────────────────────────────────────────


def _queue(client, headers, **body):
    return client.post("/api/me/device/queue", json=body, headers=headers)


def test_queue_an_album_with_start_index_and_delivery(client, listener):
    artist = _artist("Queue Band")
    album = _album(artist, "Queue Record")
    tracks = _tracks(album, 4)

    for _, headers in _both(listener):
        response = _queue(
            client,
            headers,
            node=f"album:{album['entity_uid']}",
            start_item_id=f"track:{tracks[2]['entity_uid']}",
            delivery="balanced",
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["start_index"] == 2
        assert body["continuation"] is None
        assert [t["entityUid"] for t in body["tracks"]] == [
            t["entity_uid"] for t in tracks
        ]
        assert body["tracks"][0] == {
            "id": tracks[0]["entity_uid"],
            "entityUid": tracks[0]["entity_uid"],
            "url": f"/api/tracks/by-entity/{tracks[0]['entity_uid']}/stream?delivery=balanced",
            "title": "T1",
            "artist": "Queue Band",
            "album": "Queue Record",
            "artwork": f"/api/albums/by-entity/{album['entity_uid']}/cover?size=512",
            "durationMs": 201000,
        }

        for delivery in ("original", "auto"):
            plain = _queue(
                client, headers, node=f"album:{album['entity_uid']}", delivery=delivery
            ).json()
            assert plain["tracks"][0]["url"] == (
                f"/api/tracks/by-entity/{tracks[0]['entity_uid']}/stream"
            )
            assert plain["start_index"] == 0
        saver = _queue(
            client, headers, node=f"album:{album['entity_uid']}", delivery="data_saver"
        ).json()
        assert saver["tracks"][0]["url"].endswith("?delivery=data_saver")


def test_queue_playlist_liked_and_explicit_ids(client, listener):
    user, _, _ = listener
    other, _ = _signed_in(f"q-other-{uuid.uuid4().hex[:8]}@test.com")
    artist = _artist()
    tracks = _tracks(_album(artist, "Queue Sources"), 4)
    playlist_id = _playlist("Q", user["id"], [tracks[3], tracks[1]])
    private = _playlist("Theirs", other["id"], tracks)
    _like(user["id"], tracks[0], _NOW)
    _like(user["id"], tracks[2], _NOW - timedelta(minutes=1))

    def uids(response) -> list[str]:
        assert response.status_code == 200, response.text
        return [t["entityUid"] for t in response.json()["tracks"]]

    for _, headers in _both(listener):
        assert uids(_queue(client, headers, node=f"playlist:{playlist_id}")) == [
            tracks[3]["entity_uid"],
            tracks[1]["entity_uid"],
        ]
        assert _queue(client, headers, node=f"playlist:{private}").status_code == 404
        assert uids(_queue(client, headers, node="liked")) == [
            tracks[0]["entity_uid"],
            tracks[2]["entity_uid"],
        ]
        explicit = _queue(
            client,
            headers,
            item_ids=[
                f"track:{tracks[2]['entity_uid']}",
                f"track:{uuid.uuid4()}",
                f"track:{tracks[0]['entity_uid'].upper()}",
                f"track:{tracks[2]['entity_uid']}",
            ],
            start_item_id=f"track:{tracks[0]['entity_uid']}",
        )
        assert uids(explicit) == [tracks[2]["entity_uid"], tracks[0]["entity_uid"]]
        assert explicit.json()["start_index"] == 1


def test_queue_shuffle_keeps_the_start_track_first(client, listener):
    _, headers, _ = listener
    album = _album(_artist(), "Shuffle")
    tracks = _tracks(album, 12)
    start = tracks[7]["entity_uid"]
    response = _queue(
        client,
        headers,
        node=f"album:{album['entity_uid']}",
        start_item_id=f"track:{start}",
        shuffle=True,
    )
    body = response.json()
    assert body["start_index"] == 0
    assert body["tracks"][0]["entityUid"] == start
    assert sorted(t["entityUid"] for t in body["tracks"]) == sorted(
        t["entity_uid"] for t in tracks
    )


def test_queue_caps_at_500_tracks(client, listener):
    _, headers, _ = listener
    album = _album(_artist(), "Box set")
    tracks = _tracks(album, 505)
    response = _queue(client, headers, node=f"album:{album['entity_uid']}")
    assert response.status_code == 200
    body = response.json()
    assert len(body["tracks"]) == 500
    assert body["tracks"][-1]["entityUid"] == tracks[499]["entity_uid"]

    too_many = _queue(
        client, headers, item_ids=[f"track:{uuid.uuid4()}" for _ in range(501)]
    )
    assert too_many.status_code == 422


def test_queue_resolves_tracks_in_one_batched_query(pg_db):
    from crate.db.queries.device_library import get_device_tracks_by_entity_uids

    album = _album(_artist(), "Batched")
    tracks = _tracks(album, 30)
    with recorded_statements() as recorded:
        rows = get_device_tracks_by_entity_uids([t["entity_uid"] for t in tracks])
    assert len(rows) == 30
    assert len(recorded) == 1


def test_queue_validates_its_body(client, listener):
    _, headers, _ = listener
    album = _album(_artist(), "Invalid")
    for body in (
        {},
        {"node": "liked", "item_ids": [f"track:{uuid.uuid4()}"]},
        {"item_ids": [f"album:{album['entity_uid']}"]},
        {"item_ids": []},
        {"node": "liked", "delivery": "lossless"},
        {"node": "liked", "extra": True},
        {"node": "home"},
        {"node": "root"},
        {"node": "radio"},
    ):
        response = _queue(client, headers, **body)
        assert response.status_code == 422, (body, response.text)
    assert _queue(client, headers, node="album:" + str(uuid.uuid4())).status_code == 404
    assert _queue(client, headers, node="nope").status_code == 404


def test_queue_artist_top_tracks(client, listener, monkeypatch):
    artist = _artist("Top Band")
    album = _album(artist, "Hits")
    tracks = _tracks(album, 3)
    seen = []

    def _top(name):
        seen.append(name)
        return [{"track_entity_uid": t["entity_uid"]} for t in reversed(tracks)]

    monkeypatch.setattr("crate.api.device_library._artist_top_tracks", _top)
    _, headers, device = listener
    for credentials in (headers, device):
        response = _queue(client, credentials, node=f"artist:{artist['entity_uid']}")
        assert [t["entityUid"] for t in response.json()["tracks"]] == [
            t["entity_uid"] for t in reversed(tracks)
        ]
        assert response.json()["continuation"] is None
    assert seen == ["Top Band", "Top Band"]


def test_queue_mix_and_station_return_a_continuation(client, listener, monkeypatch):
    user, headers, device = listener
    artist = _artist("Radio Band")
    album = _album(artist, "Radio Record")
    tracks = _tracks(album, 3)
    radio_calls = []

    def _radio(descriptor, *, user, limit, exclude_entity_uids):
        radio_calls.append((dict(descriptor), user["id"], limit))
        return [{"track_entity_uid": t["entity_uid"]} for t in tracks], False

    monkeypatch.setattr("crate.api.radio.continuation_radio_tracks", _radio)
    monkeypatch.setattr(
        "crate.db.home.get_home_playlist",
        lambda user_id, mix_id, limit: {
            "id": mix_id,
            "tracks": [{"track_entity_uid": t["entity_uid"]} for t in tracks[:2]],
        },
    )

    for credentials in (headers, device):
        station = _queue(client, credentials, node=f"station:artist:{artist['id']}")
        assert station.status_code == 200, station.text
        assert len(station.json()["tracks"]) == 3
        assert station.json()["continuation"] == {
            "batchIndex": None,
            "kind": "seeded_radio",
            "sessionId": None,
            "seedType": "artist",
            "seedId": str(artist["id"]),
        }

        mix = _queue(client, credentials, node="mix:daily-discovery")
        assert mix.status_code == 200, mix.text
        assert [t["entityUid"] for t in mix.json()["tracks"]] == [
            t["entity_uid"] for t in tracks[:2]
        ]
        assert mix.json()["continuation"]["seedType"] == "home_playlist"
        assert mix.json()["continuation"]["seedId"] == "daily-discovery"

    assert {call[1] for call in radio_calls} == {user["id"]}
    assert radio_calls[0][0]["seedType"] == "artist"


def test_queue_mix_missing_is_404(client, listener, monkeypatch):
    _, headers, _ = listener
    monkeypatch.setattr(
        "crate.db.home.get_home_playlist", lambda user_id, mix_id, limit: None
    )
    assert _queue(client, headers, node="mix:missing-mix").status_code == 404


@pytest.mark.parametrize(
    ("delivery", "in_url_when_original", "suffix"),
    [
        ("original", True, "?delivery=original"),
        ("original", False, ""),
        ("balanced", False, "?delivery=balanced"),
        ("data_saver", True, "?delivery=data_saver"),
    ],
)
def test_native_track_fields_url_delivery(delivery, in_url_when_original, suffix):
    from crate.api.smart_mix import native_track_fields

    uid = str(uuid.uuid4())
    fields = native_track_fields(
        {"track_entity_uid": uid, "title": "Song", "duration": 1.5},
        delivery,
        delivery_in_url_when_original=in_url_when_original,
    )
    assert fields == {
        "id": uid,
        "entityUid": uid,
        "url": f"/api/tracks/by-entity/{uid}/stream{suffix}",
        "title": "Song",
        "artist": "",
        "album": None,
        "durationMs": 1500,
    }
    assert native_track_fields({"title": "No entity"}, delivery) is None
    assert native_track_fields({"entity_uid": uid, "playable": False}, delivery) is None
