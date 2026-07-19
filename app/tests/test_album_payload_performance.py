from crate.api.schemas.browse import AlbumTrackResponse


def test_album_track_response_keeps_playback_features_but_omits_unused_scores():
    track = AlbumTrackResponse(
        id=7,
        filename="01 - Distances.flac",
        size_mb=31.2,
        length_sec=183,
        tags={"title": "Distances"},
        path="High Vis/Blending/01 - Distances.flac",
        bliss_vector=[0.1] * 20,
        bpm=128.0,
        popularity_score=0.91,
        popularity_confidence=0.82,
    ).model_dump()

    assert track["bliss_vector"] == [0.1] * 20
    assert track["bpm"] == 128.0
    assert "popularity_score" not in track
    assert "popularity_confidence" not in track
