from datetime import datetime, timezone

from crate.feeds.editorial import EditorialFeedFetchResult
from crate.feeds.rss import RSSFeedFetchResult, RSSFeedHTTPError, RSSFeedItem
from crate.feeds.rss import RSSFeedNotFoundError
from crate.worker_handlers.feeds import (
    FEED_TASK_HANDLERS,
    _handle_external_feeds_discover_sources,
    _handle_external_feeds_refresh_editorial,
    _handle_external_feeds_refresh,
)


def _source(**overrides):
    source = {
        "id": 11,
        "source_url": "https://example.bandcamp.com/feed",
        "artist_id": 42,
        "etag": '"old"',
        "last_modified": "Sat, 22 Aug 2026",
        "refresh_interval_seconds": 21600,
        "consecutive_failures": 0,
    }
    source.update(overrides)
    return source


def _item():
    return RSSFeedItem(
        external_guid="release-1",
        title="New release",
        canonical_url="https://example.bandcamp.com/album/new-release",
        published_at=datetime(2026, 8, 22, tzinfo=timezone.utc),
        author="Example artist",
        excerpt="A new release.",
        image_url="https://example.bandcamp.com/image.jpg",
        item_kind="release",
        content_hash="a" * 64,
        payload={"title": "New release"},
    )


def test_feed_task_handler_is_registered():
    assert set(FEED_TASK_HANDLERS) == {
        "external_feeds_discover_sources",
        "external_feeds_enrich_item",
        "external_feeds_refresh_editorial",
        "external_feeds_refresh",
    }
    assert callable(FEED_TASK_HANDLERS["external_feeds_discover_sources"])
    assert callable(FEED_TASK_HANDLERS["external_feeds_enrich_item"])
    assert callable(FEED_TASK_HANDLERS["external_feeds_refresh_editorial"])
    assert callable(FEED_TASK_HANDLERS["external_feeds_refresh"])


def test_external_feed_source_discovery_is_inert_when_feature_flag_is_disabled(
    monkeypatch,
):
    monkeypatch.delenv("CRATE_EXTERNAL_RSS_ENABLED", raising=False)
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_bandcamp_feed_candidates",
        lambda **kwargs: (_ for _ in ()).throw(
            AssertionError("must not query candidates")
        ),
    )

    assert _handle_external_feeds_discover_sources("task-1", {}, {}) == {
        "enabled": False,
        "candidates_checked": 0,
        "sources_registered": 0,
    }


def test_external_feed_source_discovery_registers_public_rss(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_bandcamp_feed_candidates",
        lambda **kwargs: [
            {
                "artist_id": 42,
                "artist_name": "Example",
                "artist_url": "https://example.bandcamp.com",
                "association_method": "explicit_artist_url",
            }
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.select_bandcamp_feed_candidates",
        lambda rows, limit: rows,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.discover_rss_feed_from_page",
        lambda *args, **kwargs: "https://example.bandcamp.com/feed",
    )
    registered = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.upsert_external_feed_source",
        lambda **kwargs: registered.append(kwargs) or {"id": 11},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_discover_sources("task-1", {}, {})

    assert result == {
        "enabled": True,
        "candidates_checked": 1,
        "candidates_with_feed": 1,
        "sources_registered": 1,
        "candidates_without_feed": 0,
        "candidates_failed": 0,
    }
    assert registered == [
        {
            "source_kind": "bandcamp_rss",
            "source_url": "https://example.bandcamp.com/feed",
            "canonical_url": "https://example.bandcamp.com",
            "artist_id": 42,
            "association_method": "explicit_artist_url",
            "parser_version": "bandcamp-rss-v1",
        }
    ]


def test_external_feed_source_discovery_treats_missing_artist_feed_as_no_feed(
    monkeypatch,
):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_bandcamp_feed_candidates",
        lambda **kwargs: [
            {
                "artist_id": 42,
                "artist_name": "Example",
                "artist_url": "https://example.bandcamp.com",
                "association_method": "explicit_artist_url",
            }
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.discover_rss_feed_from_page",
        lambda *args, **kwargs: (_ for _ in ()).throw(RSSFeedNotFoundError()),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_discover_sources("task-1", {}, {})

    assert result["candidates_without_feed"] == 1
    assert result["candidates_failed"] == 0


def test_external_feed_refresh_is_inert_when_feature_flag_is_disabled(monkeypatch):
    monkeypatch.delenv("CRATE_EXTERNAL_RSS_ENABLED", raising=False)
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_due_external_feed_sources",
        lambda **kwargs: (_ for _ in ()).throw(
            AssertionError("must not query sources")
        ),
    )

    assert _handle_external_feeds_refresh("task-1", {}, {}) == {
        "enabled": False,
        "sources_checked": 0,
    }


def test_editorial_feed_refresh_is_inert_when_feature_flag_is_disabled(monkeypatch):
    monkeypatch.delenv("CRATE_EXTERNAL_RSS_ENABLED", raising=False)
    monkeypatch.setattr(
        "crate.worker_handlers.feeds._list_due_editorial_feed_sources",
        lambda limit: (_ for _ in ()).throw(
            AssertionError("must not query editorial sources")
        ),
    )

    assert _handle_external_feeds_refresh_editorial("task-1", {}, {}) == {
        "enabled": False,
        "sources_checked": 0,
    }


def test_editorial_feed_refresh_respects_robots_and_persists_items(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds._list_due_editorial_feed_sources",
        lambda limit: [_source(source_kind="artist_site")],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.can_fetch_editorial_source",
        lambda *args, **kwargs: True,
    )
    item = _item()
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_editorial_feed",
        lambda *args, **kwargs: EditorialFeedFetchResult(
            not_modified=False,
            items=(item,),
            etag='"editorial"',
            last_modified="Sun, 23 Aug 2026",
            content_type="application/rss+xml",
        ),
    )
    upserted = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.upsert_external_feed_item",
        lambda **kwargs: upserted.append(kwargs) or {"id": 100},
    )
    checked = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_not_modified",
        lambda *args, **kwargs: checked.append((args, kwargs)) or _source(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh_editorial("task-1", {}, {})

    assert result["sources_succeeded"] == 1
    assert result["items_upserted"] == 1
    assert result["sources_blocked_by_robots"] == 0
    assert upserted[0]["item_kind"] == "release"
    assert upserted[0]["parser_version"] == "editorial-feed-v1"
    assert checked[0][1]["etag"] == '"editorial"'


def test_editorial_refresh_includes_global_publisher_sources(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds._list_due_editorial_feed_sources",
        lambda limit: [_source(source_kind="publisher_rss", artist_id=None)],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.can_fetch_editorial_source",
        lambda *args, **kwargs: True,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_editorial_feed",
        lambda *args, **kwargs: EditorialFeedFetchResult(
            not_modified=True,
            items=(),
            etag='"publisher"',
            last_modified=None,
            content_type="application/rss+xml",
        ),
    )
    marked = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_not_modified",
        lambda *args, **kwargs: marked.append((args, kwargs)) or _source(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh_editorial("task-1", {}, {})

    assert result["sources_not_modified"] == 1
    assert marked[0][1]["etag"] == '"publisher"'


def test_publisher_refresh_queues_ai_summary_for_enabled_sources(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setenv("CRATE_EXTERNAL_FEED_AI_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds._list_due_editorial_feed_sources",
        lambda limit: [
            _source(
                source_kind="publisher_rss",
                artist_id=None,
                ai_policy="enabled",
            )
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.can_fetch_editorial_source",
        lambda *args, **kwargs: True,
    )
    item = _item()
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_editorial_feed",
        lambda *args, **kwargs: EditorialFeedFetchResult(
            not_modified=False,
            items=(item,),
            etag=None,
            last_modified=None,
            content_type="application/rss+xml",
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.upsert_external_feed_item",
        lambda **kwargs: {"id": 101, "content_hash": item.content_hash},
    )
    queued = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.create_task_dedup",
        lambda *args, **kwargs: queued.append((args, kwargs)) or "task-ai-101",
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_not_modified",
        lambda *args, **kwargs: _source(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh_editorial("task-1", {}, {})

    assert result["items_upserted"] == 1
    assert result["enrichments_queued"] == 1
    assert queued[0][0][0] == "external_feeds_enrich_item"
    assert queued[0][0][1]["item_id"] == 101
    assert queued[0][0][1]["operation"] == "summary"


def test_editorial_feed_refresh_skips_sources_disallowed_by_robots(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds._list_due_editorial_feed_sources",
        lambda limit: [_source(source_kind="artist_site")],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.can_fetch_editorial_source",
        lambda *args, **kwargs: False,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_editorial_feed",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("robots.txt must be checked before fetching")
        ),
    )
    failures = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_failure",
        lambda *args, **kwargs: failures.append((args, kwargs)) or _source(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh_editorial("task-1", {}, {})

    assert result["sources_failed"] == 1
    assert result["sources_blocked_by_robots"] == 1
    assert failures[0][0] == (11,)
    assert failures[0][1]["error"] == "Blocked by robots.txt"


def test_external_feed_refresh_persists_items_and_cache_validators(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_due_external_feed_sources",
        lambda **kwargs: [_source()],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_rss_feed",
        lambda *args, **kwargs: RSSFeedFetchResult(
            not_modified=False,
            items=(_item(),),
            etag='"next"',
            last_modified="Sun, 23 Aug 2026",
            content_type="application/rss+xml",
        ),
    )
    upserted = []
    checked = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.upsert_external_feed_item",
        lambda **kwargs: upserted.append(kwargs) or {"id": 100},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_not_modified",
        lambda *args, **kwargs: checked.append((args, kwargs)) or _source(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh("task-1", {}, {})

    assert result == {
        "enabled": True,
        "sources_checked": 1,
        "sources_succeeded": 1,
        "sources_not_modified": 0,
        "sources_not_found": 0,
        "sources_failed": 0,
        "items_upserted": 1,
        "enrichments_queued": 0,
    }
    assert upserted[0]["source_id"] == 11
    assert upserted[0]["artist_id"] == 42
    assert upserted[0]["external_guid"] == "release-1"
    assert checked == [((11,), {"etag": '"next"', "last_modified": "Sun, 23 Aug 2026"})]


def test_external_feed_refresh_marks_304_without_upserting_items(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_due_external_feed_sources",
        lambda **kwargs: [_source()],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_rss_feed",
        lambda *args, **kwargs: RSSFeedFetchResult(
            not_modified=True,
            items=(),
            etag='"same"',
            last_modified="Sun, 23 Aug 2026",
            content_type="application/rss+xml",
        ),
    )
    checked = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_not_modified",
        lambda *args, **kwargs: checked.append((args, kwargs)) or _source(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.upsert_external_feed_item",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("304 has no items")),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh("task-1", {}, {})

    assert result["sources_not_modified"] == 1
    assert result["items_upserted"] == 0
    assert checked[0][1]["etag"] == '"same"'


def test_external_feed_refresh_moves_missing_source_to_not_found(monkeypatch):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_due_external_feed_sources",
        lambda **kwargs: [_source()],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_rss_feed",
        lambda *args, **kwargs: (_ for _ in ()).throw(RSSFeedHTTPError(404)),
    )
    missing = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_not_found",
        lambda *args, **kwargs: (
            missing.append((args, kwargs)) or _source(state="not_found")
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_failure",
        lambda **kwargs: (_ for _ in ()).throw(
            AssertionError("404 is not a transient failure")
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh("task-1", {}, {})

    assert result["sources_not_found"] == 1
    assert result["sources_failed"] == 0
    assert missing[0][0] == (11,)


def test_external_feed_refresh_applies_retry_after_and_jitter_to_transient_error(
    monkeypatch,
):
    monkeypatch.setenv("CRATE_EXTERNAL_RSS_ENABLED", "true")
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.list_due_external_feed_sources",
        lambda **kwargs: [_source()],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.fetch_rss_feed",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RSSFeedHTTPError(429, retry_after_seconds=120)
        ),
    )
    failures = []
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.mark_external_feed_source_failure",
        lambda *args, **kwargs: (
            failures.append({**kwargs, "source_id": args[0]})
            or _source(state="degraded")
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.feeds.random", lambda: 0.0)
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.emit_task_event", lambda *args: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.feeds.is_cancelled", lambda task_id: False
    )

    result = _handle_external_feeds_refresh("task-1", {}, {})

    assert result["sources_failed"] == 1
    assert failures[0]["retry_after_seconds"] == 120
