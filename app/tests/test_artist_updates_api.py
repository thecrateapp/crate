from types import SimpleNamespace


def _request(user_id: int = 9):
    return SimpleNamespace(state=SimpleNamespace(user={"id": user_id}))


def test_artist_updates_endpoint_returns_normalized_artist_news(monkeypatch):
    from crate.api import browse_artist

    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 9})
    monkeypatch.setattr(browse_artist, "has_active_connection", lambda _user_id: False)
    monkeypatch.setattr(
        browse_artist,
        "list_external_feed_items_for_artist",
        lambda user_id, artist_id, limit, offset: [
            {
                "id": 41,
                "source_kind": "publisher_rss",
                "display_name": "Pitchfork",
                "artist_name": "Target Artist",
                "title": "Target Artist announces a new record",
                "canonical_url": "https://example.test/news/41",
                "published_at": "2026-08-23T12:00:00+00:00",
            }
        ],
    )

    result = browse_artist.artist_updates(_request(), 7, limit=20, offset=0)

    assert result[0]["type"] == "news"
    assert result[0]["artist"] == "Target Artist"
    assert result[0]["source_detail"] == "Pitchfork"
    assert result[0]["external_feed_item_id"] == 41


def test_global_updates_endpoint_uses_the_same_feed_projection(monkeypatch):
    from crate.api import me

    monkeypatch.setattr(me, "_require_auth", lambda _request: {"id": 9})
    monkeypatch.setattr(me, "has_active_connection", lambda _user_id: False)
    monkeypatch.setattr(
        me,
        "list_external_feed_items_for_user",
        lambda user_id, limit: [
            {
                "id": 51,
                "source_kind": "publisher_rss",
                "display_name": "Bandcamp Daily",
                "artist_name": "Another Artist",
                "title": "A new scene report",
                "canonical_url": "https://example.test/news/51",
                "published_at": "2026-08-22T12:00:00+00:00",
            }
        ],
    )

    result = me.updates(_request(), limit=20, offset=0)

    assert result[0]["type"] == "news"
    assert result[0]["source_detail"] == "Bandcamp Daily"
    assert result[0]["external_feed_item_id"] == 51
