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


def test_external_feed_source_not_found_stops_future_polling(pg_db):
    from crate.db.repositories import external_feeds

    source = _source(external_feeds)
    checked_at = datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc)

    missing = external_feeds.mark_external_feed_source_not_found(
        source["id"],
        error="HTTP 404",
        checked_at=checked_at,
    )

    assert missing is not None
    assert missing["state"] == "not_found"
    assert missing["last_error"] == "HTTP 404"
    assert missing["next_fetch_at"] is None
    assert external_feeds.list_due_external_feed_sources(now=checked_at) == []


def test_bandcamp_feed_candidates_include_explicit_library_urls(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import transaction_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "RSS Candidate"})
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_artists
                SET bandcamp_url = 'https://rss-candidate.bandcamp.com'
                WHERE name = 'RSS Candidate'
                """
            )
        )

    candidates = external_feeds.list_bandcamp_feed_candidates()

    assert {
        "artist_name": "RSS Candidate",
        "artist_url": "https://rss-candidate.bandcamp.com",
        "association_method": "explicit_artist_url",
    }.items() <= candidates[0].items()


def test_bandcamp_feed_candidates_only_use_active_bandcamp_connections(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import transaction_scope
    from sqlalchemy import text

    with transaction_scope() as session:
        user_id = session.execute(
            text(
                """
                INSERT INTO users (email, created_at)
                VALUES ('feed-candidate@example.test', NOW())
                RETURNING id
                """
            )
        ).scalar_one()
        connection_id = session.execute(
            text(
                """
                INSERT INTO bandcamp_connections (
                    user_id, status, session_secret_ref, session_fingerprint,
                    connection_method, created_at, updated_at
                ) VALUES (
                    :user_id, :status, :secret_ref, :fingerprint,
                    'test', NOW(), NOW()
                )
                RETURNING id
                """
            ),
            {
                "user_id": user_id,
                "status": "connected",
                "secret_ref": "test-feed-secret",
                "fingerprint": "test-feed-fingerprint",
            },
        ).scalar_one()
        item_id = session.execute(
            text(
                """
                INSERT INTO bandcamp_items (
                    bandcamp_item_type, artist_name, item_url, artist_url,
                    first_seen_at, updated_at
                ) VALUES (
                    'artist', 'Wishlist Artist',
                    'https://wishlist-artist.bandcamp.com',
                    'https://wishlist-artist.bandcamp.com', NOW(), NOW()
                )
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO user_bandcamp_items (
                    user_id, connection_id, bandcamp_item_id, relation_type,
                    last_seen_at
                ) VALUES (:user_id, :connection_id, :item_id, 'wishlist', NOW())
                """
            ),
            {"user_id": user_id, "connection_id": connection_id, "item_id": item_id},
        )

        revoked_user_id = session.execute(
            text(
                """
                INSERT INTO users (email, created_at)
                VALUES ('revoked-feed-candidate@example.test', NOW())
                RETURNING id
                """
            )
        ).scalar_one()
        revoked_connection_id = session.execute(
            text(
                """
                INSERT INTO bandcamp_connections (
                    user_id, status, session_secret_ref, session_fingerprint,
                    connection_method, created_at, updated_at, revoked_at
                ) VALUES (
                    :user_id, 'connected', 'revoked-secret', 'revoked-fingerprint',
                    'test', NOW(), NOW(), NOW()
                )
                RETURNING id
                """
            ),
            {"user_id": revoked_user_id},
        ).scalar_one()
        revoked_item_id = session.execute(
            text(
                """
                INSERT INTO bandcamp_items (
                    bandcamp_item_type, artist_name, item_url, artist_url,
                    first_seen_at, updated_at
                ) VALUES (
                    'artist', 'Revoked Artist',
                    'https://revoked-artist.bandcamp.com',
                    'https://revoked-artist.bandcamp.com', NOW(), NOW()
                )
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO user_bandcamp_items (
                    user_id, connection_id, bandcamp_item_id, relation_type,
                    last_seen_at
                ) VALUES (:user_id, :connection_id, :item_id, 'wishlist', NOW())
                """
            ),
            {
                "user_id": revoked_user_id,
                "connection_id": revoked_connection_id,
                "item_id": revoked_item_id,
            },
        )

    candidates = external_feeds.list_bandcamp_feed_candidates()

    assert any(
        candidate["artist_name"] == "Wishlist Artist"
        and candidate["association_method"] == "bandcamp_wishlist"
        for candidate in candidates
    )
    assert not any(
        candidate["artist_name"] == "Revoked Artist" for candidate in candidates
    )
