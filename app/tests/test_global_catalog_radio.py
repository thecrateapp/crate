def test_global_radio_track_payload_includes_local_analysis_fields():
    from crate.db.queries import global_catalog

    payload = global_catalog._global_radio_track_payload(
        {
            "local_track_id": 12,
            "global_track_uid": "global-track-1",
            "global_artist_uid": "global-artist-1",
            "global_album_uid": "global-album-1",
            "local_track_entity_uid": "track-entity-1",
            "canonical_title": "0151",
            "artist_name": "High Vis",
            "local_artist_id": 7,
            "local_artist_entity_uid": "artist-entity-1",
            "album_name": "Blending",
            "local_album_id": 9,
            "local_album_entity_uid": "album-entity-1",
            "duration_seconds": 181,
            "year": "2022",
            "bpm": 122.5,
            "audio_key": "C",
            "audio_scale": "minor",
            "energy": 0.78,
            "danceability": 0.42,
            "valence": 0.31,
            "bliss_vector": [0.1, 0.2],
            "has_local": True,
            "has_remote": False,
            "has_healthy_source": True,
            "availability_json": {},
        }
    )

    assert payload["bpm"] == 122.5
    assert payload["audio_key"] == "C"
    assert payload["audio_scale"] == "minor"
    assert payload["energy"] == 0.78
    assert payload["danceability"] == 0.42
    assert payload["valence"] == 0.31
    assert payload["bliss_vector"] == [0.1, 0.2]
    assert payload["year"] == "2022"
