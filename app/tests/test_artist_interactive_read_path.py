def _local_track(*, track_id: int, title: str) -> dict:
    return {
        "id": track_id,
        "track_entity_uid": f"track-{track_id}",
        "title": title,
        "artist": "Fictitious Artist",
        "artist_id": 7,
        "artist_entity_uid": "artist-7",
        "artist_slug": "fictitious-artist",
        "album": "Local Album",
        "album_id": 11,
        "album_entity_uid": "album-11",
        "album_slug": "local-album",
        "duration": 180,
        "track_number": track_id,
        "format": "flac",
        "year": "2026",
    }


def test_artist_page_info_uses_persisted_metadata_when_cache_misses(monkeypatch):
    from crate.api import browse_artist

    monkeypatch.setattr(browse_artist, "get_cached_artist_info", lambda _name: None)
    monkeypatch.setattr(
        browse_artist,
        "get_library_artist",
        lambda _name: {
            "bio": "Persisted biography",
            "tags_json": ["post-hardcore"],
            "similar_json": [],
            "listeners": 42,
            "lastfm_playcount": 84,
        },
    )

    def unexpected_live_lastfm(*_args, **_kwargs):
        raise AssertionError("interactive artist reads must not call Last.fm")

    monkeypatch.setattr(browse_artist, "get_artist_info", unexpected_live_lastfm)

    payload = browse_artist._get_artist_page_info("Fictitious Artist")

    assert payload["bio"] == "Persisted biography"
    assert payload["tags"] == ["post-hardcore"]


def test_artist_top_tracks_use_persisted_local_ranking_when_cache_misses(
    monkeypatch,
):
    from crate.api import browse_artist

    persisted_tracks = [
        {
            **_local_track(track_id=1, title="Persisted Top Track"),
            "lastfm_top_rank": 2,
            "lastfm_playcount": 100,
        },
        {
            **_local_track(track_id=2, title="Persisted Second Track"),
            "lastfm_top_rank": 1,
            "lastfm_playcount": 200,
        },
    ]
    monkeypatch.setattr(browse_artist, "get_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browse_artist, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        browse_artist,
        "get_artist_all_tracks",
        lambda *_args, **_kwargs: persisted_tracks,
    )

    monkeypatch.setattr(
        browse_artist,
        "get_cached_top_tracks",
        lambda *_args, **_kwargs: None,
    )

    payload = browse_artist._get_artist_top_tracks_payload(
        "Fictitious Artist",
        count=2,
    )

    assert [track["title"] for track in payload] == [
        "Persisted Second Track",
        "Persisted Top Track",
    ]
