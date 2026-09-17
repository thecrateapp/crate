from __future__ import annotations

from unittest.mock import patch

import pytest

from tests.conftest import PG_AVAILABLE


USER = {
    "id": 41,
    "email": "listener@example.test",
    "username": "listener",
    "role": "user",
    "password_hash": "unused",
}
ARTIST_UID = "11111111-1111-4111-8111-111111111111"
ALBUM_UID = "22222222-2222-4222-8222-222222222222"
TRACK_UID = "33333333-3333-4333-8333-333333333333"


def _auth():
    return patch("crate.api.subsonic.legacy._subsonic_auth", return_value=USER)


def _track() -> dict:
    return {
        "global_track_uid": TRACK_UID,
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "title": "Marigold",
        "artist": "High Vis",
        "album": "Blending",
        "track_number": 1,
        "disc_number": 1,
        "duration": 228,
        "bitrate": 320,
        "format": "flac",
        "year": "2022",
        "has_cover": True,
    }


def test_global_browse_uses_typed_canonical_ids(test_app):
    with (
        _auth(),
        patch(
            "crate.subsonic.services.catalog.list_global_artists",
            return_value=[
                {
                    "global_artist_uid": ARTIST_UID,
                    "name": "High Vis",
                    "album_count": 1,
                }
            ],
        ),
    ):
        response = test_app.get("/rest/getArtists?u=listener&p=secret")

    assert response.status_code == 200
    artist = response.json()["subsonic-response"]["artists"]["index"][0]["artist"][0]
    assert artist == {
        "id": f"ga-{ARTIST_UID}",
        "name": "High Vis",
        "albumCount": 1,
    }


def test_global_album_detail_contains_global_song_ids(test_app):
    album = {
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "name": "Blending",
        "artist": "High Vis",
        "year": "2022",
        "track_count": 1,
        "duration": 228,
        "has_cover": True,
    }
    with (
        _auth(),
        patch("crate.subsonic.services.catalog.get_global_album", return_value=album),
        patch(
            "crate.subsonic.services.catalog.list_global_album_tracks",
            return_value=[_track()],
        ),
    ):
        response = test_app.get(
            f"/rest/getAlbum?u=listener&p=secret&id=gal-{ALBUM_UID}"
        )

    body = response.json()["subsonic-response"]["album"]
    assert body["id"] == f"gal-{ALBUM_UID}"
    assert body["artistId"] == f"ga-{ARTIST_UID}"
    assert body["song"][0]["id"] == f"gt-{TRACK_UID}"


def test_get_album_includes_ratings_for_the_authenticated_user(test_app):
    album = {
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "name": "Blending",
        "artist": "High Vis",
        "year": "2022",
        "track_count": 1,
        "duration": 228,
        "has_cover": True,
    }
    with (
        _auth(),
        patch("crate.subsonic.services.catalog.get_global_album", return_value=album),
        patch(
            "crate.subsonic.services.catalog.list_global_album_tracks",
            return_value=[_track()],
        ),
        patch(
            "crate.api.subsonic.legacy.preferences.get_rating", return_value=4
        ) as get_rating,
    ):
        response = test_app.get(
            f"/rest/getAlbum?u=listener&p=secret&id=gal-{ALBUM_UID}"
        )

    song = response.json()["subsonic-response"]["album"]["song"][0]
    assert song["userRating"] == 4
    get_rating.assert_called_once_with(USER["id"], f"gt-{TRACK_UID}")


def test_get_song_includes_rating_for_the_authenticated_user(test_app):
    with (
        _auth(),
        patch(
            "crate.subsonic.services.catalog.get_global_track", return_value=_track()
        ),
        patch(
            "crate.api.subsonic.legacy.preferences.get_rating", return_value=5
        ) as get_rating,
    ):
        response = test_app.get(f"/rest/getSong?u=listener&p=secret&id=gt-{TRACK_UID}")

    song = response.json()["subsonic-response"]["song"]
    assert song["userRating"] == 5
    get_rating.assert_called_once_with(USER["id"], f"gt-{TRACK_UID}")


def test_global_search_applies_server_side_caps(test_app):
    with (
        _auth(),
        patch(
            "crate.api.subsonic.legacy.search_global_catalog",
            return_value={"artists": [], "albums": [], "tracks": []},
        ) as search,
    ):
        response = test_app.get(
            "/rest/search3?u=listener&p=secret&query=vis"
            "&artistCount=100&albumCount=100&songCount=200"
        )

    assert response.status_code == 200
    search.assert_called_once_with(
        "vis", artist_limit=100, album_limit=100, track_limit=200
    )


def test_legacy_local_track_id_remains_accepted(test_app):
    local = {**_track(), "title": "Talk For Hours", "track_number": 2}
    with (
        _auth(),
        patch(
            "crate.subsonic.services.catalog.get_global_track_by_local_id",
            return_value=local,
        ),
    ):
        response = test_app.get("/rest/getSong?u=listener&p=secret&id=9")

    assert response.json()["subsonic-response"]["song"]["id"] == f"gt-{TRACK_UID}"


def test_wrong_global_id_type_returns_stable_subsonic_error(test_app):
    with _auth():
        response = test_app.get(f"/rest/getSong?u=listener&p=secret&id=gal-{ALBUM_UID}")

    error = response.json()["subsonic-response"]
    assert error["status"] == "failed"
    assert error["error"] == {
        "code": 70,
        "message": "Invalid Subsonic entity ID",
    }


def test_starred_tracks_are_read_from_global_likes(test_app):
    starred = {
        "id": f"gt-{TRACK_UID}",
        "title": "Marigold",
        "artist": "High Vis",
        "album": "Blending",
        "starred": "2026-07-14T10:00:00+00:00",
    }
    with (
        _auth(),
        patch(
            "crate.api.subsonic.legacy.preferences.get_starred",
            return_value={"artist": [], "album": [], "song": [starred]},
        ) as query,
    ):
        response = test_app.get("/rest/getStarred2?u=listener&p=secret")

    query.assert_called_once_with(USER["id"])
    song = response.json()["subsonic-response"]["starred2"]["song"][0]
    assert song["id"] == f"gt-{TRACK_UID}"
    assert song["starred"] == starred["starred"]


def test_legacy_favorite_alias_is_deduplicated_after_global_resolution():
    from crate.subsonic.services import preferences

    result = {
        "artist": [{"id": f"ga-{ARTIST_UID}", "name": "High Vis"}],
        "album": [],
        "song": [],
    }
    with (
        patch(
            "crate.subsonic.services.preferences.list_favorites",
            return_value=[
                {
                    "item_type": "artist",
                    "item_id": "ar-17",
                    "created_at": "2026-09-16T10:00:00Z",
                }
            ],
        ),
        patch(
            "crate.subsonic.services.catalog.artist_detail",
            return_value={"id": f"ga-{ARTIST_UID}", "name": "High Vis"},
        ),
    ):
        preferences._include_legacy_favorites(USER["id"], result)

    assert result["artist"] == [{"id": f"ga-{ARTIST_UID}", "name": "High Vis"}]


def test_unstar_removes_local_and_global_favorite_aliases():
    from crate.subsonic.services import preferences

    with (
        patch(
            "crate.subsonic.services.preferences._favorite_ids_for_entity",
            return_value={f"ga-{ARTIST_UID}", "ar-17"},
            create=True,
        ),
        patch(
            "crate.subsonic.services.preferences.unfollow_global_artist",
            return_value=True,
        ),
        patch(
            "crate.subsonic.services.preferences.remove_favorite", return_value=True
        ) as remove_favorite,
    ):
        assert preferences.unstar(USER["id"], "artist", f"ga-{ARTIST_UID}") is True

    assert {call.args[1:] for call in remove_favorite.call_args_list} == {
        ("artist", f"ga-{ARTIST_UID}"),
        ("artist", "ar-17"),
    }


def test_star_and_unstar_accept_repeated_ids_and_are_idempotent(test_app):
    with (
        _auth(),
        patch("crate.api.subsonic.legacy.preferences.star", return_value=True) as star,
        patch(
            "crate.api.subsonic.legacy.preferences.unstar", return_value=True
        ) as unstar,
    ):
        starred = test_app.get(
            f"/rest/star?u=listener&p=secret&id=gt-{TRACK_UID}"
            f"&albumId=gal-{ALBUM_UID}&artistId=ga-{ARTIST_UID}"
        )
        unstarred = test_app.get(
            f"/rest/unstar?u=listener&p=secret&id=gt-{TRACK_UID}"
            f"&albumId=gal-{ALBUM_UID}&artistId=ga-{ARTIST_UID}"
        )

    assert starred.json()["subsonic-response"]["status"] == "ok"
    assert unstarred.json()["subsonic-response"]["status"] == "ok"
    assert [call.args for call in star.call_args_list] == [
        (USER["id"], "artist", f"ga-{ARTIST_UID}"),
        (USER["id"], "album", f"gal-{ALBUM_UID}"),
        (USER["id"], "song", f"gt-{TRACK_UID}"),
    ]
    assert [call.args for call in unstar.call_args_list] == [
        (USER["id"], "artist", f"ga-{ARTIST_UID}"),
        (USER["id"], "album", f"gal-{ALBUM_UID}"),
        (USER["id"], "song", f"gt-{TRACK_UID}"),
    ]


def test_set_rating_uses_authenticated_user_and_rejects_out_of_range(test_app):
    with (
        _auth(),
        patch(
            "crate.api.subsonic.legacy.preferences.set_rating", return_value=True
        ) as set_rating,
    ):
        response = test_app.get(
            f"/rest/setRating?u=listener&p=secret&id=gt-{TRACK_UID}&rating=5"
        )
        invalid = test_app.get(
            f"/rest/setRating?u=listener&p=secret&id=gt-{TRACK_UID}&rating=6"
        )

    assert response.json()["subsonic-response"]["status"] == "ok"
    assert set_rating.call_args.args == (USER["id"], f"gt-{TRACK_UID}", 5)
    assert invalid.json()["subsonic-response"]["status"] == "failed"


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_global_adapter_reads_singleton_catalog_without_duplicates(pg_db):
    pg_db.upsert_artist({"name": "High Vis", "has_photo": 1})
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "year": "2022",
            "track_count": 1,
            "has_cover": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "High Vis",
            "album": "Blending",
            "filename": "01 - Talk For Hours.flac",
            "title": "Talk For Hours",
            "path": "/music/High Vis/Blending/01 - Talk For Hours.flac",
            "duration": 190.0,
            "format": "flac",
        }
    )

    from crate.db.queries.subsonic_global import (
        get_global_album_by_local_id,
        get_global_artist_by_local_id,
        get_global_track_by_local_id,
        list_global_album_tracks,
        list_global_artist_albums,
        list_global_artists,
    )
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog
    from crate.subsonic.global_ids import global_subsonic_id
    from crate.subsonic.services.catalog import album_detail, artist_detail, song_detail
    from sqlalchemy import text

    reconcile_local_catalog()

    artists = list_global_artists()
    high_vis = [artist for artist in artists if artist["name"] == "High Vis"]
    assert len(high_vis) == 1
    albums = list_global_artist_albums(high_vis[0]["global_artist_uid"])
    assert [album["name"] for album in albums] == ["Blending"]
    tracks = list_global_album_tracks(albums[0]["global_album_uid"])
    assert [track["title"] for track in tracks] == ["Talk For Hours"]

    with read_scope() as session:
        local_artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'High Vis'")
        ).scalar_one()
        local_album_id = session.execute(
            text("SELECT id FROM library_albums WHERE artist = 'High Vis'")
        ).scalar_one()
        local_track_id = session.execute(
            text("SELECT id FROM library_tracks WHERE artist = 'High Vis'")
        ).scalar_one()

    assert (
        get_global_artist_by_local_id(local_artist_id)["global_artist_uid"]
        == high_vis[0]["global_artist_uid"]
    )
    assert (
        get_global_album_by_local_id(local_album_id)["global_album_uid"]
        == albums[0]["global_album_uid"]
    )
    assert (
        get_global_track_by_local_id(local_track_id)["global_track_uid"]
        == tracks[0]["global_track_uid"]
    )
    assert artist_detail(f"ar-{local_artist_id}")["id"] == global_subsonic_id(
        "artist", high_vis[0]["global_artist_uid"]
    )
    assert album_detail(f"al-{local_album_id}")["id"] == global_subsonic_id(
        "album", albums[0]["global_album_uid"]
    )
    assert song_detail(str(local_track_id))["id"] == global_subsonic_id(
        "track", tracks[0]["global_track_uid"]
    )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_global_entity_lookups_do_not_return_unrelated_local_rows(pg_db):
    artist_name = "OpenSubsonic UID Filter Fixture"
    pg_db.upsert_artist({"name": artist_name})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "UID Filter Album",
            "path": f"/music/{artist_name}/UID Filter Album",
            "track_count": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist_name,
            "album": "UID Filter Album",
            "filename": "01 - UID Filter Track.flac",
            "title": "UID Filter Track",
            "path": f"/music/{artist_name}/UID Filter Album/01 - UID Filter Track.flac",
            "duration": 100,
            "format": "flac",
        }
    )

    from crate.db.queries.subsonic_global import (
        get_global_album,
        get_global_artist,
        get_global_track,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    reconcile_local_catalog()

    assert get_global_artist("ffffffff-ffff-4fff-8fff-fffffffffff1") is None
    assert get_global_album("ffffffff-ffff-4fff-8fff-fffffffffff2") is None
    assert get_global_track("ffffffff-ffff-4fff-8fff-fffffffffff3") is None
