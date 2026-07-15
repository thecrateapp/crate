from __future__ import annotations


ALBUM_UID = "11111111-1111-4111-8111-111111111111"
ARTIST_UID = "22222222-2222-4222-8222-222222222222"
TRACK_UID = "33333333-3333-4333-8333-333333333333"


def test_human_share_routes_report_catalog_slug_conflicts(test_app, monkeypatch):
    from crate.api import share
    from crate.db.queries.global_catalog import GlobalCatalogPublicRouteConflict

    monkeypatch.setattr(share, "get_library_artist_by_slug", lambda _ref: None)
    monkeypatch.setattr(share, "get_library_artist", lambda _name: None)
    monkeypatch.setattr(share, "get_library_albums", lambda _name: [])
    monkeypatch.setattr(
        share,
        "get_global_artist_page_by_public_slug",
        lambda _ref: (_ for _ in ()).throw(
            GlobalCatalogPublicRouteConflict("/artists/collision")
        ),
    )
    monkeypatch.setattr(
        share,
        "get_global_album_detail_by_public_slugs",
        lambda *_refs: (_ for _ in ()).throw(
            GlobalCatalogPublicRouteConflict("/artists/collision/album")
        ),
    )

    assert test_app.get("/share/artist/collision").status_code == 409
    assert test_app.get("/share/album/collision/album").status_code == 409


def test_share_album_preview_renders_open_graph(test_app, monkeypatch):
    from crate.api import share

    album = {
        "id": 42,
        "entity_uid": ALBUM_UID,
        "artist": "High Vis",
        "name": "Blending",
        "slug": "high-vis-blending",
        "track_count": 10,
        "year": "2022",
    }
    artist = {
        "id": 7,
        "entity_uid": ARTIST_UID,
        "name": "High Vis",
        "slug": "high-vis",
    }

    monkeypatch.setattr(share, "get_library_album_by_entity_uid", lambda ref: album)
    monkeypatch.setattr(share, "get_library_artist", lambda name: artist)

    response = test_app.get(
        f"/share/album/{ALBUM_UID}/blending",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert 'property="og:type" content="music.album"' in response.text
    assert 'property="og:title" content="Blending"' in response.text
    assert (
        f'property="og:image" content="https://listen.example.test/share/image/album/{ALBUM_UID}"'
        in response.text
    )
    assert (
        'href="https://listen.example.test/artists/high-vis/blending"' in response.text
    )


def test_share_track_preview_deep_links_to_track(test_app, monkeypatch):
    from crate.api import share

    track = {
        "id": 99,
        "entity_uid": TRACK_UID,
        "album_id": 42,
        "artist": "High Vis",
        "album": "Blending",
        "title": "Talk for Hours",
        "filename": "01 Talk for Hours.flac",
    }
    album = {
        "id": 42,
        "entity_uid": ALBUM_UID,
        "artist": "High Vis",
        "name": "Blending",
        "slug": "high-vis-blending",
        "track_count": 10,
    }
    artist = {
        "id": 7,
        "entity_uid": ARTIST_UID,
        "name": "High Vis",
        "slug": "high-vis",
    }

    monkeypatch.setattr(share, "get_library_track_by_entity_uid", lambda ref: track)
    monkeypatch.setattr(share, "get_library_album_by_id", lambda album_id: album)
    monkeypatch.setattr(share, "get_library_artist", lambda name: artist)

    response = test_app.get(
        f"/share/track/{TRACK_UID}/talk-for-hours",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert 'property="og:type" content="music.song"' in response.text
    assert 'property="og:title" content="Talk for Hours"' in response.text
    assert (
        f'property="og:image" content="https://listen.example.test/share/image/album/{ALBUM_UID}"'
        in response.text
    )
    assert (
        f'href="https://listen.example.test/artists/high-vis/blending?track={TRACK_UID}"'
        in response.text
    )


def test_share_track_preview_falls_back_to_global_catalog_track(test_app, monkeypatch):
    from crate.api import share

    global_album_uid = "44444444-4444-4444-8444-444444444444"
    global_track = {
        "global_track_uid": TRACK_UID,
        "global_artist_uid": "55555555-5555-4555-8555-555555555555",
        "global_album_uid": global_album_uid,
        "artist": "High Vis",
        "album": "Blending",
        "title": "Talk for Hours",
    }

    monkeypatch.setattr(share, "get_library_track_by_entity_uid", lambda ref: None)
    monkeypatch.setattr(share, "get_global_track_info", lambda ref: global_track)
    monkeypatch.setattr(share, "get_library_artist", lambda name: None)

    response = test_app.get(
        f"/share/track/{TRACK_UID}/talk-for-hours",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert 'property="og:type" content="music.song"' in response.text
    assert (
        f'property="og:image" content="https://listen.example.test/api/catalog/albums/{global_album_uid}/cover"'
        in response.text
    )
    assert (
        f'href="https://listen.example.test/artists/high-vis/blending?track={TRACK_UID}"'
        in response.text
    )


def test_human_artist_share_preview_resolves_global_catalog(test_app, monkeypatch):
    from crate.api import share

    artist = {
        "id": None,
        "global_artist_uid": ARTIST_UID,
        "name": "High Vis",
        "slug": "high-vis",
        "albums": [{"name": "Blending"}],
        "total_tracks": 10,
    }
    monkeypatch.setattr(share, "get_library_artist_by_slug", lambda ref: None)
    monkeypatch.setattr(share, "get_library_artist", lambda name: None)
    monkeypatch.setattr(
        share,
        "get_global_artist_page_by_public_slug",
        lambda ref: {"artist": artist} if ref == "high-vis" else None,
    )

    response = test_app.get(
        "/share/artist/high-vis",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert 'property="og:title" content="High Vis"' in response.text
    assert f"/api/catalog/artists/{ARTIST_UID}/photo" in response.text
    assert 'href="https://listen.example.test/artists/high-vis"' in response.text


def test_human_album_share_preview_resolves_global_catalog(test_app, monkeypatch):
    from crate.api import share

    album = {
        "id": None,
        "global_album_uid": ALBUM_UID,
        "artist": "High Vis",
        "artist_slug": "high-vis",
        "name": "Blending",
        "slug": "blending",
        "track_count": 10,
        "year": "2022",
    }
    monkeypatch.setattr(share, "get_library_album_by_entity_uid", lambda ref: None)
    monkeypatch.setattr(share, "get_library_artist_by_slug", lambda ref: None)
    monkeypatch.setattr(share, "get_library_artist", lambda name: None)
    monkeypatch.setattr(
        share,
        "get_global_album_detail_by_public_slugs",
        lambda artist_slug, album_slug: (
            album if (artist_slug, album_slug) == ("high-vis", "blending") else None
        ),
    )

    response = test_app.get(
        "/share/album/high-vis/blending",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert 'property="og:title" content="Blending"' in response.text
    assert f"/api/catalog/albums/{ALBUM_UID}/cover" in response.text
    assert (
        'href="https://listen.example.test/artists/high-vis/blending"' in response.text
    )


def test_reserved_album_slug_uses_explicit_human_album_route(test_app, monkeypatch):
    from crate.api import share

    album = {
        "id": None,
        "global_album_uid": ALBUM_UID,
        "artist": "High Vis",
        "artist_slug": "high-vis",
        "name": "Top Tracks",
        "slug": "top-tracks",
        "track_count": 4,
    }
    monkeypatch.setattr(share, "get_library_artist_by_slug", lambda ref: None)
    monkeypatch.setattr(share, "get_library_artist", lambda name: None)
    monkeypatch.setattr(
        share,
        "get_global_album_detail_by_public_slugs",
        lambda artist_slug, album_slug: album,
    )

    response = test_app.get(
        "/share/album/high-vis/top-tracks",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert (
        'href="https://listen.example.test/artists/high-vis/albums/top-tracks"'
        in response.text
    )
