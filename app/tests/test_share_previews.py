from __future__ import annotations


ALBUM_UID = "11111111-1111-4111-8111-111111111111"
ARTIST_UID = "22222222-2222-4222-8222-222222222222"
TRACK_UID = "33333333-3333-4333-8333-333333333333"


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
