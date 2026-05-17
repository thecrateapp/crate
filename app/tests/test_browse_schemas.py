from crate.api.schemas.browse import ArtistShowEventResponse


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
