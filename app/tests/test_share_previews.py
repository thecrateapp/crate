from __future__ import annotations


ALBUM_UID = "11111111-1111-4111-8111-111111111111"
ARTIST_UID = "22222222-2222-4222-8222-222222222222"
TRACK_UID = "33333333-3333-4333-8333-333333333333"
CRATE_ID = "77777777-7777-4777-8777-777777777777"
CRATE_REF = "year-end-records-Ab3dE7gh"


def _public_crate(**overrides):
    crate = {
        "id": CRATE_ID,
        "short_code": "Ab3dE7gh",
        "public_ref": CRATE_REF,
        "name": "Year-end records",
        "description": "",
        "owner_name": "Jane Doe",
        "owner_avatar": "https://images.example.test/jane.png",
        "is_ordered": True,
        "sort_direction": "asc",
        "album_count": 1,
        "track_count": 10,
        "follower_count": 3,
        "albums": [
            {
                "global_album_uid": ALBUM_UID,
                "position": 0,
                "name": "Blending",
                "artist_name": "High Vis",
                "year": "2022",
                "has_cover": True,
            }
        ],
    }
    crate.update(overrides)
    return crate


def test_public_crate_preview_uses_composite_image_and_links_to_listen(
    test_app, monkeypatch
):
    from crate.api import share

    monkeypatch.setattr(
        share, "resolve_crate_ref", lambda ref: CRATE_ID if ref == CRATE_REF else None
    )
    monkeypatch.setattr(
        share,
        "get_crate_for_user",
        lambda _crate_id, _user_id: (_public_crate(), "public"),
    )

    response = test_app.get(
        f"/share/crate/{CRATE_REF}",
        headers={"host": "listen.example.test", "x-forwarded-proto": "https"},
    )

    assert response.status_code == 200
    assert '<html lang="en">' in response.text
    assert (
        f'property="og:url" content="https://listen.example.test/share/crate/{CRATE_REF}"'
        in response.text
    )
    assert 'property="og:type" content="website"' in response.text
    assert 'property="og:locale" content="en_US"' in response.text
    assert (
        'property="og:description" content="A selection of 1 album by Jane Doe on Crate."'
        in response.text
    )
    assert 'property="og:title" content="Year-end records"' in response.text
    assert (
        f'property="og:image" content="https://listen.example.test/share/image/crate/{CRATE_REF}?lang=en"'
        in response.text
    )
    assert 'property="og:image:type" content="image/jpeg"' in response.text
    assert f"/share/image/crate/{CRATE_REF}/album/{ALBUM_UID}?size=512" in response.text
    assert "/api/catalog/albums/" not in response.text
    assert 'src="https://images.example.test/jane.png"' in response.text
    assert "1 album · 10 tracks · 3 followers" in response.text
    assert f'href="https://listen.example.test/crate/{CRATE_REF}"' in response.text
    assert "Open in Crate" in response.text


def test_public_crate_preview_uses_accessible_crate_query(test_app, monkeypatch):
    from crate.api import share

    calls: list[tuple[str, None]] = []
    monkeypatch.setattr(
        share,
        "get_crate_for_user",
        lambda crate_id, user_id: (
            calls.append((crate_id, user_id)) or (_public_crate(albums=[]), "public")
        ),
    )

    response = test_app.get(f"/share/crate/{CRATE_ID}", follow_redirects=False)
    assert response.status_code == 301
    assert response.headers["location"].endswith(f"/share/crate/{CRATE_REF}")
    assert calls == [(CRATE_ID, None)]


def test_public_crate_preview_is_localized_and_respects_descending_order(
    test_app, monkeypatch
):
    from crate.api import share

    crate = _public_crate(
        sort_direction="desc",
        album_count=2,
        albums=[
            {
                "global_album_uid": ALBUM_UID,
                "position": 0,
                "name": "Primero",
                "artist_name": "High Vis",
                "has_cover": False,
            },
            {
                "global_album_uid": "66666666-6666-4666-8666-666666666666",
                "position": 1,
                "name": "Segundo",
                "artist_name": "High Vis",
                "has_cover": False,
            },
        ],
    )
    monkeypatch.setattr(
        share, "get_crate_for_user", lambda _crate_id, _user_id: (crate, "public")
    )
    monkeypatch.setattr(share, "resolve_crate_ref", lambda _ref: CRATE_ID)

    response = test_app.get(
        f"/share/crate/{CRATE_REF}",
        headers={"accept-language": "fr-CH, de;q=0.9, es;q=0.95"},
    )

    assert response.status_code == 200
    assert '<html lang="fr">' in response.text
    assert "Ouvrir dans Crate" in response.text
    assert "2 albums" in response.text
    assert response.text.index("Segundo") < response.text.index("Primero")
    assert "/album/" not in response.text


def test_private_crate_preview_is_html_not_found_without_loading_private_metadata(
    test_app, monkeypatch
):
    from crate.api import share

    monkeypatch.setattr(
        share,
        "get_crate_for_user",
        lambda _crate_id, _user_id: (None, "none"),
    )

    response = test_app.get(
        f"/share/crate/{CRATE_ID}", headers={"accept-language": "it"}
    )

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("text/html")
    assert '<html lang="it">' in response.text
    assert "Crate non trovato" in response.text


def test_missing_share_artwork_uses_png_placeholder(test_app, monkeypatch):
    from crate.api import share

    monkeypatch.setattr(share, "get_library_album_by_entity_uid", lambda _ref: None)

    response = test_app.get(f"/share/image/album/{ALBUM_UID}?size=64")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


def test_language_negotiation_prefers_highest_quality_supported_language():
    from crate.api.share_crate_assets import negotiate_language

    assert negotiate_language("pt-BR, eu;q=0.8, es;q=0.9") == "es"
    assert negotiate_language("pt-BR") == "en"
    assert negotiate_language("es", requested="eu") == "eu"
    assert negotiate_language("de;q=0, it") == "it"


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
