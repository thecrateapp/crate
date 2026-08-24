from crate.api.external_feeds import (
    PublisherFeedSourceCreateRequest,
    PublisherFeedSourceUpdateRequest,
    create_publisher_feed_source,
    list_publisher_feed_items,
    refresh_publisher_feed_source,
    update_publisher_feed_source,
)


def test_admin_can_create_global_publisher_source_and_queue_initial_refresh(
    monkeypatch,
):
    monkeypatch.setattr(
        "crate.api.external_feeds.require_permission", lambda *_args: {"id": 7}
    )
    captured = []
    monkeypatch.setattr(
        "crate.api.external_feeds.upsert_external_feed_source",
        lambda **kwargs: (
            captured.append(kwargs) or {"id": 12, "source_scope": "publisher", **kwargs}
        ),
    )
    monkeypatch.setattr(
        "crate.api.external_feeds.create_task_dedup",
        lambda *args, **kwargs: "task-12",
    )

    result = create_publisher_feed_source(
        None,
        PublisherFeedSourceCreateRequest(
            source_url="https://pitchfork.com/feed/rss",
            canonical_url="https://pitchfork.com/",
            display_name="Pitchfork",
            publisher_name="Pitchfork",
            category="music_news",
            language="es",
        ),
    )

    assert result["source"]["id"] == 12
    assert result["task_id"] == "task-12"
    assert captured[0]["source_kind"] == "publisher_rss"
    assert captured[0]["source_scope"] == "publisher"
    assert captured[0]["artist_id"] is None
    assert captured[0]["language"] == "es"


def test_admin_can_update_and_refresh_global_publisher_source(monkeypatch):
    monkeypatch.setattr(
        "crate.api.external_feeds.require_permission", lambda *_args: {"id": 7}
    )
    updated = []
    monkeypatch.setattr(
        "crate.api.external_feeds.update_external_feed_source",
        lambda source_id, **kwargs: (
            updated.append((source_id, kwargs))
            or {"id": source_id, "state": kwargs["state"]}
        ),
    )
    monkeypatch.setattr(
        "crate.api.external_feeds.create_task_dedup",
        lambda *args, **kwargs: "task-refresh",
    )
    monkeypatch.setattr(
        "crate.api.external_feeds.mark_external_feed_source_due",
        lambda source_id: {"id": source_id, "source_scope": "publisher"},
    )

    source = update_publisher_feed_source(
        None,
        12,
        PublisherFeedSourceUpdateRequest(
            state="disabled", category="reviews", language="es"
        ),
    )
    refreshed = refresh_publisher_feed_source(None, 12)

    assert source == {"id": 12, "state": "disabled"}
    assert refreshed == {"source_id": 12, "task_id": "task-refresh"}
    assert updated == [
        (12, {"state": "disabled", "category": "reviews", "language": "es"})
    ]


def test_admin_can_preview_cached_items_for_a_global_source(monkeypatch):
    monkeypatch.setattr(
        "crate.api.external_feeds.require_permission", lambda *_args: {"id": 7}
    )
    monkeypatch.setattr(
        "crate.api.external_feeds.list_external_feed_items_for_source",
        lambda source_id, limit: [
            {"id": source_id, "title": "Cached article", "limit": limit}
        ],
    )

    assert list_publisher_feed_items(None, 12, limit=5) == {
        "items": [{"id": 12, "title": "Cached article", "limit": 5}]
    }
