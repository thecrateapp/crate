from crate.api.schemas.browse import ArtistShowEventResponse
from crate.api.schemas.media import TrackRefResponse


def test_track_ref_exposes_vdj_search_metadata() -> None:
    track = TrackRefResponse(
        title="Talk For Hours",
        artist="High Vis",
        album="Blending",
        year="2022",
        genre="post punk",
        bpm=95.0,
        audio_key="F#",
        audio_scale="minor",
        has_cover=True,
        cover_url="/api/vdj/albums/37/cover?size=512",
    )

    assert track.year == "2022"
    assert track.genre == "post punk"
    assert track.has_cover is True
    assert track.cover_url == "/api/vdj/albums/37/cover?size=512"


def test_artist_show_event_keeps_external_id_but_drops_non_db_show_id() -> None:
    event = ArtistShowEventResponse(
        id="G5viZbMJ8uEYl",
        show_id="G5viZbMJ8uEYl",
        artist_name="Depeche Mode",
    )

    assert event.id == "G5viZbMJ8uEYl"
    assert event.show_id is None


def test_artist_show_event_accepts_numeric_db_show_id() -> None:
    event = ArtistShowEventResponse(
        id=123,
        show_id="123",
        artist_name="Depeche Mode",
    )

    assert event.id == "123"
    assert event.show_id == 123
