from unittest.mock import patch

import pytest


def test_get_lyrics_returns_a_valid_empty_result_when_cache_misses():
    from crate.subsonic.services import discovery

    with patch.object(discovery, "get_cached_lyrics", return_value=None):
        result = discovery.get_lyrics("Unknown", "Unreleased")

    assert result == {"artist": "Unknown", "title": "Unreleased", "value": ""}


def test_get_lyrics_serves_stale_cached_lyrics_to_subsonic_clients():
    from crate.subsonic.services import discovery

    cached = {"syncedLyrics": "[00:01.00]Line", "plainLyrics": None}
    with patch.object(discovery, "get_cached_lyrics", return_value=cached) as lookup:
        result = discovery.get_lyrics(" Artist ", " Song ")

    assert result["value"] == "Line"
    lookup.assert_called_once_with("Artist", "Song", max_age_seconds=None)


def test_get_lyrics_by_song_id_returns_synced_and_unsynced_lines():
    from crate.subsonic.services import discovery

    track = {"artist": "Artist", "title": "Song"}
    lyrics = {
        "syncedLyrics": "[00:01.25]First line\n[00:02.500]Second line",
        "plainLyrics": "First line\nSecond line",
    }
    with (
        patch.object(discovery, "_track_for_subsonic_id", return_value=(None, track)),
        patch.object(discovery, "get_cached_lyrics", return_value=lyrics) as lookup,
    ):
        result = discovery.get_lyrics_by_song_id("gt-123")

    lookup.assert_called_once_with("Artist", "Song", max_age_seconds=None)
    assert result["structuredLyrics"] == [
        {
            "lang": "und",
            "synced": True,
            "line": [
                {"start": 1250, "value": "First line"},
                {"start": 2500, "value": "Second line"},
            ],
        },
        {
            "lang": "und",
            "synced": False,
            "line": [{"value": "First line"}, {"value": "Second line"}],
        },
    ]


def test_get_lyrics_by_song_id_returns_empty_list_when_lyrics_are_missing():
    from crate.subsonic.services import discovery

    with (
        patch.object(
            discovery,
            "_track_for_subsonic_id",
            return_value=(None, {"artist": "Artist", "title": "Song"}),
        ),
        patch.object(
            discovery,
            "get_cached_lyrics",
            return_value={"syncedLyrics": None, "plainLyrics": None},
        ),
    ):
        result = discovery.get_lyrics_by_song_id("gt-123")

    assert result == {"structuredLyrics": []}


def test_get_lyrics_by_song_id_rejects_unknown_song():
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError
    from crate.subsonic.services import discovery

    with (
        patch.object(discovery, "_track_for_subsonic_id", return_value=None),
        pytest.raises(OpenSubsonicError) as error,
    ):
        discovery.get_lyrics_by_song_id("gt-missing")

    assert error.value.code == ErrorCode.NOT_FOUND


def test_get_top_songs_supports_artist_ids_and_deduplicates_in_rank_order():
    from crate.subsonic.services import discovery

    artist = {"global_artist_uid": "artist-uid", "name": "Artist"}
    tracks = [
        {"global_track_uid": "track-1", "title": "First"},
        {"global_track_uid": "track-1", "title": "First duplicate"},
        {"global_track_uid": "track-2", "title": "Second"},
    ]
    with (
        patch.object(discovery, "_artist_for_identifier", return_value=artist),
        patch.object(
            discovery, "get_top_songs_for_artist", return_value=tracks
        ) as top_songs_query,
        patch.object(
            discovery,
            "serialize_song",
            side_effect=lambda track: {"title": track["title"]},
        ),
    ):
        result = discovery.get_top_songs(artist_id="ga-artist", count=999)

    assert [song["title"] for song in result] == ["First", "Second"]
    assert top_songs_query.call_args.kwargs["limit"] == 500


def test_get_top_songs_requires_artist_or_supported_artist_id():
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError
    from crate.subsonic.services import discovery

    with pytest.raises(OpenSubsonicError) as error:
        discovery.get_top_songs(count=50)

    assert error.value.code == ErrorCode.MISSING_PARAMETER


def test_get_top_songs_by_name_resolves_exact_library_artist_without_inventing_rows():
    from crate.subsonic.services import discovery

    with (
        patch.object(
            discovery,
            "get_global_artists_by_names",
            return_value=[{"global_artist_uid": "artist-uid", "name": "Artist"}],
        ) as artist_lookup,
        patch.object(discovery, "get_top_songs_for_artist", return_value=[]) as tracks,
    ):
        result = discovery.get_top_songs(artist=" Artist ", count=10)

    assert result == []
    artist_lookup.assert_called_once_with(["Artist"], include_not_present=True, limit=1)
    tracks.assert_called_once_with("artist-uid", limit=10)


def test_similar_songs_uses_bliss_and_returns_ranked_unique_library_matches():
    from crate.subsonic.services import discovery

    seed = {"vector": [0.1] * 20, "paths": {"seed.flac"}}
    candidates = [
        {"track_id": 2, "path": "first.flac"},
        {"track_id": 2, "path": "first.flac"},
        {"track_id": 1, "path": "seed.flac"},
        {"track_id": 3, "path": "second.flac"},
    ]
    global_tracks = {
        2: {"global_track_uid": "track-2", "title": "First"},
        3: {"global_track_uid": "track-3", "title": "Second"},
    }
    with (
        patch.object(discovery, "_seed_for_identifier", return_value=seed),
        patch.object(
            discovery, "get_bliss_candidates", return_value=candidates
        ) as candidates_query,
        patch.object(
            discovery, "get_global_tracks_by_local_ids", return_value=global_tracks
        ) as global_lookup,
        patch.object(
            discovery,
            "serialize_song",
            side_effect=lambda track: {"title": track["title"]},
        ),
    ):
        result = discovery.get_similar_songs("gt-seed", count=2)

    assert [song["title"] for song in result] == ["First", "Second"]
    assert candidates_query.call_args.kwargs["limit"] == 500
    assert global_lookup.call_args.args == ([2, 3],)


def test_track_seed_retains_artist_fallback_when_bliss_vector_is_missing():
    from crate.subsonic.services import discovery

    track_path = "/music/high-vis/0151.flac"
    bliss_track = {
        "path": track_path,
        "bliss_vector": None,
        "artist_id": 14,
        "album_artist": "High Vis",
    }
    with (
        patch.object(
            discovery,
            "_track_for_subsonic_id",
            return_value=(None, {"path": track_path}),
        ),
        patch.object(
            discovery, "get_track_with_artist", return_value=bliss_track
        ) as track_lookup,
    ):
        seed = discovery._seed_for_identifier("gt-17cb1586-396f-5c8f-9048-5ca6d1964d53")

    track_lookup.assert_called_once_with(track_path=track_path)
    assert seed == {
        "vector": None,
        "paths": {track_path},
        "track_path": track_path,
        "artist_id": 14,
        "artist_name": "High Vis",
    }


def test_similar_songs_falls_back_to_same_artist_without_seed_vector():
    from crate.subsonic.services import discovery

    seed = {
        "vector": None,
        "paths": {"seed.flac"},
        "track_path": "seed.flac",
        "artist_id": 14,
        "artist_name": "High Vis",
    }
    same_artist = [
        {"track_id": 2, "path": "related.flac"},
        {"track_id": 2, "path": "related.flac"},
        {"track_id": 1, "path": "seed.flac"},
    ]
    global_tracks = {2: {"global_track_uid": "track-2", "title": "Related"}}
    with (
        patch.object(discovery, "_seed_for_identifier", return_value=seed),
        patch.object(discovery, "get_bliss_candidates") as bliss_candidates,
        patch.object(
            discovery,
            "get_same_artist_tracks",
            return_value=same_artist,
            create=True,
        ) as artist_query,
        patch.object(
            discovery, "get_global_tracks_by_local_ids", return_value=global_tracks
        ) as global_lookup,
        patch.object(
            discovery,
            "serialize_song",
            side_effect=lambda track: {"title": track["title"]},
        ),
    ):
        result = discovery.get_similar_songs("gt-seed", count=5)

    assert [song["title"] for song in result] == ["Related"]
    bliss_candidates.assert_not_called()
    artist_query.assert_called_once_with(
        artist_id=14,
        artist_name="High Vis",
        exclude_path="seed.flac",
        limit=500,
    )
    assert global_lookup.call_args.args == ([2],)


def test_similar_songs_falls_back_to_same_artist_when_bliss_has_no_matches():
    from crate.subsonic.services import discovery

    seed = {
        "vector": [0.1] * 20,
        "paths": {"seed.flac"},
        "track_path": "seed.flac",
        "artist_id": 14,
        "artist_name": "High Vis",
    }
    with (
        patch.object(discovery, "_seed_for_identifier", return_value=seed),
        patch.object(discovery, "get_bliss_candidates", return_value=[]),
        patch.object(
            discovery,
            "get_same_artist_tracks",
            return_value=[{"track_id": 2, "path": "related.flac"}],
            create=True,
        ),
        patch.object(
            discovery,
            "get_global_tracks_by_local_ids",
            return_value={2: {"global_track_uid": "track-2", "title": "Related"}},
        ),
        patch.object(
            discovery,
            "serialize_song",
            side_effect=lambda track: {"title": track["title"]},
        ),
    ):
        result = discovery.get_similar_songs("gt-seed", count=5)

    assert [song["title"] for song in result] == ["Related"]


def test_similar_songs_degrades_to_empty_when_bliss_is_unavailable():
    from crate.subsonic.services import discovery

    with (
        patch.object(discovery, "_seed_for_identifier", return_value=None),
        patch.object(discovery, "get_bliss_candidates") as candidates,
    ):
        result = discovery.get_similar_songs("ga-artist", count=50)

    assert result == []
    candidates.assert_not_called()


def test_discovery_endpoints_require_auth_and_render_contract_shapes(test_app):
    from tests.subsonic.contract_helpers import validate_json_response

    with patch("crate.subsonic.auth.authenticate", return_value={"id": 1}):
        with (
            patch(
                "crate.subsonic.services.discovery.get_lyrics",
                return_value={"artist": "Artist", "title": "Song", "value": ""},
            ),
            patch(
                "crate.subsonic.services.discovery.get_lyrics_by_song_id",
                return_value={
                    "structuredLyrics": [
                        {
                            "lang": "und",
                            "synced": True,
                            "line": [{"start": 1250, "value": "Line"}],
                        }
                    ]
                },
            ),
        ):
            lyrics = test_app.get(
                "/rest/getLyrics?u=listener&p=secret&artist=Artist&title=Song&f=json"
            )
            lyrics_by_id = test_app.get(
                "/rest/getLyricsBySongId?u=listener&p=secret&id=123&f=json"
            )

    lyrics_payload = lyrics.json()
    by_id_payload = lyrics_by_id.json()
    assert validate_json_response(lyrics_payload) == []
    assert validate_json_response(by_id_payload) == []
    assert lyrics_payload["subsonic-response"]["lyrics"] == {
        "artist": "Artist",
        "title": "Song",
        "value": "",
    }
    assert by_id_payload["subsonic-response"]["lyricsList"]["structuredLyrics"][0][
        "line"
    ] == [{"start": 1250, "value": "Line"}]


def test_lyrics_route_defaults_to_standard_xml_mixed_content(test_app):
    import xml.etree.ElementTree as ET

    with (
        patch("crate.subsonic.auth.authenticate", return_value={"id": 1}),
        patch(
            "crate.subsonic.services.discovery.get_lyrics",
            return_value={"artist": "Artist", "title": "Song", "value": "A lyric"},
        ),
    ):
        response = test_app.get(
            "/rest/getLyrics?u=listener&p=secret&artist=Artist&title=Song"
        )

    root = ET.fromstring(response.content)
    namespace = "{http://subsonic.org/restapi}"
    lyrics = root.find(f"{namespace}lyrics")
    assert response.headers["content-type"].startswith("application/xml")
    assert root.attrib["openSubsonic"] == "true"
    assert lyrics is not None
    assert lyrics.attrib == {"artist": "Artist", "title": "Song"}
    assert lyrics.text == "A lyric"


def test_discovery_endpoints_return_subsonic_auth_errors(test_app):
    with patch("crate.subsonic.auth.authenticate", return_value=None):
        response = test_app.get("/rest/getSimilarSongs?u=listener&p=bad&id=123&f=json")

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["error"]["code"] == 40


def test_discovery_routes_and_complete_extensions_are_registered(test_app):
    from crate.subsonic.capabilities import advertised_extensions

    paths = {route.path for route in test_app.app.routes}
    assert {
        "/rest/getLyrics",
        "/rest/getLyrics.view",
        "/rest/getLyricsBySongId",
        "/rest/getTopSongs",
        "/rest/getSimilarSongs",
        "/rest/getSimilarSongs2",
    }.issubset(paths)
    assert {"name": "songLyrics", "versions": [1, 2]} in advertised_extensions()
    assert {"name": "topSongsByArtistId", "versions": [1]} in advertised_extensions()


def test_top_and_similar_song_responses_match_pinned_contract(test_app):
    from tests.subsonic.contract_helpers import validate_json_response

    with (
        patch("crate.subsonic.auth.authenticate", return_value={"id": 1}),
        patch("crate.subsonic.services.discovery.get_top_songs", return_value=[]),
        patch("crate.subsonic.services.discovery.get_similar_songs", return_value=[]),
    ):
        top = test_app.get(
            "/rest/getTopSongs?u=listener&p=secret&artist=Unknown&count=5&f=json"
        )
        similar = test_app.get(
            "/rest/getSimilarSongs?u=listener&p=secret&id=123&f=json"
        )
        similar2 = test_app.get(
            "/rest/getSimilarSongs2?u=listener&p=secret&id=123&f=json"
        )

    for response in (top, similar, similar2):
        assert validate_json_response(response.json()) == []
    assert top.json()["subsonic-response"]["topSongs"] == {"song": []}
    assert similar.json()["subsonic-response"]["similarSongs"] == {"song": []}
    assert similar2.json()["subsonic-response"]["similarSongs2"] == {"song": []}


def test_discovery_parameter_errors_use_subsonic_envelopes(test_app):
    with (
        patch("crate.subsonic.auth.authenticate", return_value={"id": 1}),
        patch(
            "crate.subsonic.services.discovery.get_lyrics_by_song_id",
            return_value={"structuredLyrics": []},
        ),
    ):
        missing = test_app.get("/rest/getSimilarSongs?u=listener&p=secret&f=json")
        invalid_count = test_app.get(
            "/rest/getTopSongs?u=listener&p=secret&artist=Artist&count=-1&f=json"
        )
        enhanced = test_app.get(
            "/rest/getLyricsBySongId?u=listener&p=secret&id=123&enhanced=true&f=json"
        )
        invalid_enhanced = test_app.get(
            "/rest/getLyricsBySongId?u=listener&p=secret&id=123&enhanced=maybe&f=json"
        )

    assert missing.json()["subsonic-response"]["error"]["code"] == 10
    assert invalid_count.json()["subsonic-response"]["error"]["code"] == 10
    assert enhanced.json()["subsonic-response"]["status"] == "ok"
    assert invalid_enhanced.json()["subsonic-response"]["error"]["code"] == 10
