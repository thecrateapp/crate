from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "crate/db/migrations/versions/090_external_feed_sources.py"


def test_external_feed_migration_separates_sources_and_items():
    source = MIGRATION.read_text()

    assert 'revision = "090"' in source
    assert 'down_revision = "089"' in source
    assert "external_feed_sources" in source
    assert "external_feed_items" in source
    assert "etag" in source and "last_modified" in source
    assert "content_hash" in source and "parser_version" in source
    assert "duplicate_of_id" in source
    assert "ON DELETE CASCADE" in source
    assert "ON DELETE SET NULL" in source


def _source(repo):
    return repo.upsert_external_feed_source(
        source_kind="artist_site",
        source_url="https://artist.example/news.xml",
        canonical_url="https://artist.example/news",
        parser_version="artist-site-v1",
        refresh_interval_seconds=3600,
    )


def test_external_feed_source_preserves_http_cache_metadata_and_tracks_due_time(pg_db):
    from crate.db.repositories import external_feeds

    source = _source(external_feeds)
    checked_at = datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc)

    refreshed = external_feeds.mark_external_feed_source_not_modified(
        source["id"],
        etag='"v1"',
        last_modified="Sat, 23 Aug 2026 11:00:00 GMT",
        checked_at=checked_at,
    )
    assert refreshed is not None
    assert refreshed["state"] == "active"
    assert refreshed["etag"] == '"v1"'
    assert refreshed["last_modified"] == "Sat, 23 Aug 2026 11:00:00 GMT"
    assert refreshed["next_fetch_at"] == checked_at + timedelta(hours=1)
    assert external_feeds.get_external_feed_source(source["id"])["etag"] == '"v1"'

    updated = external_feeds.upsert_external_feed_source(
        source_kind="artist_site",
        source_url="https://artist.example/news.xml",
        parser_version="artist-site-v2",
        refresh_interval_seconds=7200,
    )
    assert updated["id"] == source["id"]
    assert updated["parser_version"] == "artist-site-v2"
    assert updated["etag"] == '"v1"'
    assert updated["refresh_interval_seconds"] == 7200

    assert (
        external_feeds.list_due_external_feed_sources(
            now=checked_at + timedelta(minutes=30)
        )
        == []
    )
    assert (
        external_feeds.list_due_external_feed_sources(
            now=checked_at + timedelta(hours=1, minutes=1)
        )[0]["id"]
        == source["id"]
    )


def test_external_feed_item_upsert_updates_identity_and_marks_duplicate_content(pg_db):
    from crate.db.repositories import external_feeds

    source = _source(external_feeds)
    first = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url="https://artist.example/news.xml",
        canonical_url="https://artist.example/news/first",
        external_guid="guid-1",
        title="First announcement",
        content_hash="hash-a",
        parser_version="artist-site-v1",
        payload={"title": "First announcement"},
    )
    updated = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url="https://artist.example/news.xml",
        canonical_url="https://artist.example/news/first",
        external_guid="guid-2",
        title="Updated announcement",
        content_hash="hash-b",
        parser_version="artist-site-v2",
        payload={"title": "Updated announcement"},
    )

    assert updated["id"] == first["id"]
    assert updated["external_guid"] == "guid-2"
    assert updated["title"] == "Updated announcement"
    assert updated["state"] == "active"

    duplicate = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url="https://artist.example/news.xml",
        canonical_url="https://artist.example/news/copy",
        external_guid="guid-3",
        title="Copied announcement",
        content_hash="hash-b",
        parser_version="artist-site-v2",
        payload={"title": "Copied announcement"},
    )

    assert duplicate["id"] != updated["id"]
    assert duplicate["state"] == "duplicate"
    assert duplicate["duplicate_of_id"] == updated["id"]

    bounded = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url="https://artist.example/news.xml",
        canonical_url="https://artist.example/news/large",
        external_guid="guid-4",
        title="Large announcement",
        content_hash="hash-c",
        parser_version="artist-site-v2",
        payload={"body": "x" * 70000},
    )
    assert bounded["payload_json"]["truncated"] is True
    assert bounded["payload_json"]["size_bytes"] > 64 * 1024


def test_external_feed_source_failure_marks_degraded_with_backoff(pg_db):
    from crate.db.repositories import external_feeds

    source = _source(external_feeds)
    failed_at = datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc)

    failed = external_feeds.mark_external_feed_source_failure(
        source["id"],
        error="timeout",
        failed_at=failed_at,
        retry_after_seconds=900,
    )

    assert failed is not None
    assert failed["state"] == "degraded"
    assert failed["last_error"] == "timeout"
    assert failed["consecutive_failures"] == 1
    assert failed["next_fetch_at"] == failed_at + timedelta(seconds=900)
