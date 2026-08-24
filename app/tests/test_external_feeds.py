from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "crate/db/migrations/versions/090_external_feed_sources.py"
AI_MIGRATION = ROOT / "crate/db/migrations/versions/091_external_feed_ai_enrichments.py"
CLUSTER_MIGRATION = (
    ROOT / "crate/db/migrations/versions/093_external_feed_cluster_applications.py"
)
PUBLISHER_CATALOG_MIGRATION = (
    ROOT / "crate/db/migrations/versions/096_global_publisher_feed_catalog.py"
)


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


def test_global_publisher_migration_adds_metadata_and_seeds_initial_sources():
    migration = (
        ROOT / "crate/db/migrations/versions/094_global_publisher_feed_sources.py"
    ).read_text()

    assert 'revision = "094"' in migration
    assert 'down_revision = "093"' in migration
    assert "publisher_rss" in migration
    assert "source_scope" in migration
    assert "ai_policy" in migration
    assert "https://pitchfork.com/feed/rss" in migration
    assert "https://daily.bandcamp.com/feed" in migration


def test_external_feed_artist_association_migration_tracks_reviewable_associations():
    migration = (
        ROOT / "crate/db/migrations/versions/095_external_feed_artist_associations.py"
    ).read_text()

    assert 'revision = "095"' in migration
    assert 'down_revision = "094"' in migration
    assert "associate_artist" in migration
    assert "artist_association_method" in migration
    assert "artist_association_confidence" in migration
    assert "artist_associated_by_user_id" in migration


def test_global_publisher_catalog_migration_seeds_requested_sources_and_languages():
    migration = PUBLISHER_CATALOG_MIGRATION.read_text()

    assert 'revision = "096"' in migration
    assert 'down_revision = "095"' in migration
    assert "language" in migration
    assert "ON CONFLICT (source_url) DO UPDATE" in migration
    assert "metal_punk_hardcore" in migration
    assert "hip_hop" in migration
    assert "alternative_underground" in migration
    for source_url in (
        "https://metalstorm.net/rss/news.xml",
        "https://lambgoat.com/rss.xml",
        "https://idioteq.com/feed/",
        "https://dyingscene.com/feed/",
        "https://www.punktastic.com/feed/",
        "https://www.scienceofnoise.net/feed/",
        "https://ughhblog.com/feed/",
        "https://thewordisbond.com/feed/",
        "https://hiphopdx.com/rss",
        "https://cvltnation.com/feed/",
        "https://www.brooklynvegan.com/feed/",
        "https://scenepointblank.com/blog/rss",
    ):
        assert source_url in migration


def test_global_publisher_catalog_is_seeded_at_database_head(pg_db):
    from crate.db.tx import read_scope

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT source_url, category, language
                FROM external_feed_sources
                WHERE source_kind = 'publisher_rss'
                  AND source_scope = 'publisher'
                ORDER BY source_url
                """
                )
            )
            .mappings()
            .all()
        )

    assert len(rows) == 14
    by_url = {row["source_url"]: row for row in rows}
    assert by_url["https://www.scienceofnoise.net/feed/"]["language"] == "es"
    assert by_url["https://metalstorm.net/rss/news.xml"]["category"] == (
        "metal_punk_hardcore"
    )
    assert by_url["https://hiphopdx.com/rss"]["category"] == "hip_hop"
    assert by_url["https://cvltnation.com/feed/"]["category"] == (
        "alternative_underground"
    )


def test_external_feed_artist_association_auto_match_is_persisted_and_invalidated(
    pg_db,
):
    from crate.db.repositories import external_feed_associations, external_feeds

    pg_db.upsert_artist({"name": "Neon Wolves", "slug": "neon-wolves"})
    source = external_feeds.upsert_external_feed_source(
        source_kind="publisher_rss",
        source_scope="publisher",
        source_url="https://publisher.example/feed.xml",
        parser_version="editorial-feed-v1",
    )
    item = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://publisher.example/neon-wolves-news",
        external_guid="neon-1",
        title="Neon Wolves announce a new album",
        content_hash="neon-hash-1",
        parser_version="editorial-feed-v1",
    )

    association = (
        external_feed_associations.associate_external_feed_item_deterministically(
            item["id"]
        )
    )

    assert association["applied"] is True
    assert association["auto_candidate"]["artist_name"] == "Neon Wolves"
    associated = external_feeds.get_external_feed_item(item["id"])
    assert associated["artist_id"] is not None
    assert associated["artist_association_method"] == "deterministic_title_match"

    refreshed = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url=source["source_url"],
        canonical_url=item["canonical_url"],
        external_guid="neon-1",
        title=item["title"],
        content_hash="neon-hash-1",
        parser_version="editorial-feed-v1",
    )
    assert refreshed["artist_id"] == associated["artist_id"]

    changed = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url=source["source_url"],
        canonical_url=item["canonical_url"],
        external_guid="neon-1",
        title="A broad independent music roundup",
        content_hash="neon-hash-2",
        parser_version="editorial-feed-v1",
    )
    assert changed["artist_id"] is None
    assert changed["artist_association_method"] is None


def test_accepting_artist_association_applies_ai_choice_atomically(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Example Artist", "slug": "example-artist"})
    source = external_feeds.upsert_external_feed_source(
        source_kind="publisher_rss",
        source_scope="publisher",
        source_url="https://publisher-ai.example/feed.xml",
        parser_version="editorial-feed-v1",
    )
    item = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        item_kind="news",
        source_url=source["source_url"],
        title="New music from Example Artist",
        content_hash="ai-association-hash",
        parser_version="editorial-feed-v1",
    )
    with read_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Example Artist'")
        ).scalar_one()
    enrichment = external_feeds.queue_external_feed_item_enrichment(
        item_id=item["id"],
        operation="associate_artist",
        source_content_hash="ai-association-hash",
        prompt_version="external-feed-artist-association-v1",
    )
    external_feeds.mark_external_feed_enrichment_ready(
        enrichment["id"],
        result={
            "operation": "associate_artist",
            "artist_id": artist_id,
            "artist_name": "Example Artist",
            "confidence": 0.92,
            "reason": "The title explicitly names the artist.",
            "warnings": [],
            "candidates": [
                {
                    "artist_id": artist_id,
                    "artist_name": "Example Artist",
                    "artist_slug": "example-artist",
                    "score": 0.96,
                    "reasons": ["Exact artist name in title"],
                }
            ],
        },
        model="ollama/test",
        prompt_version="external-feed-artist-association-v1",
    )

    reviewed = external_feeds.review_external_feed_enrichment(
        enrichment["id"], reviewer_id=1, decision="accept"
    )

    assert reviewed["review_status"] == "accepted"
    associated = external_feeds.get_external_feed_item(item["id"])
    assert associated["artist_id"] == artist_id
    assert associated["artist_association_method"] == "ai_review"
    assert associated["artist_associated_by_user_id"] == 1


def test_external_feed_ai_migration_preserves_reviewable_provenance():
    source = AI_MIGRATION.read_text()

    assert 'revision = "091"' in source
    assert 'down_revision = "090"' in source
    assert "source_content_hash" in source
    assert "prompt_version" in source
    assert "review_status" in source
    assert "reviewed_by_user_id" in source
    assert "external_feed_enrichments" in source


def test_external_feed_cluster_migration_tracks_reversible_applications():
    source = CLUSTER_MIGRATION.read_text()

    assert 'revision = "093"' in source
    assert 'down_revision = "092"' in source
    assert "cluster_applied_at" in source
    assert "cluster_applied_by_user_id" in source
    assert "cluster_applied_item_ids" in source
    assert "cluster_reverted_at" in source
    assert "cluster_reverted_by_user_id" in source


def test_feed_cluster_context_marks_hidden_members_without_breaking_the_read_path():
    from crate.db.repositories.external_feeds import _attach_feed_cluster_context

    rows = [
        {
            "id": 10,
            "title": "Representative",
            "source_kind": "bandcamp_rss",
            "canonical_url": "https://artist.example/representative",
            "published_at": "2026-08-23T12:00:00+00:00",
            "accepted_cluster_enrichment_id": 5,
            "accepted_cluster_json": {
                "cluster_type": "release",
                "members": [
                    {
                        "item_id": 10,
                        "role": "representative",
                        "reason": "Primary item.",
                    },
                    {
                        "item_id": 11,
                        "role": "related",
                        "reason": "Duplicate coverage.",
                    },
                ],
                "confidence": 0.95,
                "rationale": "The items cover the same release.",
                "warnings": [],
            },
            "accepted_cluster_applied_at": "2026-08-23T13:00:00+00:00",
            "accepted_cluster_reverted_at": None,
        }
    ]

    result = _attach_feed_cluster_context(rows)

    assert result[0]["feed_clusters"][0]["applied"] is True
    assert result[0]["feed_clusters"][0]["members"][1]["visible"] is False
    assert "accepted_cluster_json" not in result[0]


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
            now=checked_at + timedelta(minutes=30), source_kind="artist_site"
        )
        == []
    )
    assert (
        external_feeds.list_due_external_feed_sources(
            now=checked_at + timedelta(hours=1, minutes=1),
            source_kind="artist_site",
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


def test_external_feed_cluster_candidates_are_artist_and_time_bounded(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import transaction_scope
    from sqlalchemy import text

    artist_name = "Cluster Candidate Artist"
    other_artist_name = "Other Cluster Artist"
    pg_db.upsert_artist({"name": artist_name})
    pg_db.upsert_artist({"name": other_artist_name})
    with transaction_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = :name"),
            {"name": artist_name},
        ).scalar_one()
        other_artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = :name"),
            {"name": other_artist_name},
        ).scalar_one()

    source = external_feeds.upsert_external_feed_source(
        source_kind="artist_site",
        source_url="https://cluster.example/news.xml",
        artist_id=artist_id,
        parser_version="cluster-test-v1",
    )
    published_at = datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc)
    target = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://cluster.example/target",
        external_guid="cluster-target",
        title="Target announcement",
        content_hash="cluster-target-hash",
        parser_version="cluster-test-v1",
        published_at=published_at,
    )
    nearby = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="release",
        source_url=source["source_url"],
        canonical_url="https://cluster.example/nearby",
        external_guid="cluster-nearby",
        title="Nearby release",
        content_hash="cluster-nearby-hash",
        parser_version="cluster-test-v1",
        published_at=published_at + timedelta(days=1),
    )
    outside = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://cluster.example/outside",
        external_guid="cluster-outside",
        title="Outside window",
        content_hash="cluster-outside-hash",
        parser_version="cluster-test-v1",
        published_at=published_at + timedelta(days=46),
    )
    other_artist = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=other_artist_id,
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://cluster.example/other-artist",
        external_guid="cluster-other-artist",
        title="Other artist",
        content_hash="cluster-other-artist-hash",
        parser_version="cluster-test-v1",
        published_at=published_at + timedelta(days=1),
    )
    duplicate_original = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://cluster.example/duplicate-original",
        external_guid="cluster-duplicate-original",
        title="Duplicate original",
        content_hash="cluster-duplicate-hash",
        parser_version="cluster-test-v1",
        published_at=published_at + timedelta(days=2),
    )
    duplicate = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://cluster.example/duplicate",
        external_guid="cluster-duplicate",
        title="Duplicate item",
        content_hash="cluster-duplicate-hash",
        parser_version="cluster-test-v1",
        published_at=published_at + timedelta(days=2),
    )

    candidates = external_feeds.list_external_feed_cluster_candidates(target["id"])
    candidate_ids = {candidate["id"] for candidate in candidates}

    assert nearby["id"] in candidate_ids
    assert outside["id"] not in candidate_ids
    assert other_artist["id"] not in candidate_ids
    assert duplicate_original["id"] in candidate_ids
    assert duplicate["id"] not in candidate_ids


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
    assert (
        external_feeds.list_due_external_feed_sources(
            now=checked_at, source_kind="artist_site"
        )
        == []
    )


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


def test_external_feed_items_are_scoped_to_connected_users_and_follows(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import transaction_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Followed Feed Artist"})
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_artists
                SET bandcamp_url = 'https://followed-feed.bandcamp.com'
                WHERE name = 'Followed Feed Artist'
                """
            )
        )
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Followed Feed Artist'")
        ).scalar_one()
        user_id = session.execute(
            text(
                """
                INSERT INTO users (email, created_at)
                VALUES ('updates-feed-user@example.test', NOW())
                RETURNING id
                """
            )
        ).scalar_one()
        other_user_id = session.execute(
            text(
                """
                INSERT INTO users (email, created_at)
                VALUES ('updates-feed-other@example.test', NOW())
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (:user_id, 'Followed Feed Artist', NOW())
                """
            ),
            {"user_id": user_id},
        )
        connection_ids = {}
        for target_user_id, suffix in (
            (user_id, "primary"),
            (other_user_id, "other"),
        ):
            connection_ids[target_user_id] = session.execute(
                text(
                    """
                    INSERT INTO bandcamp_connections (
                        user_id, status, session_secret_ref, session_fingerprint,
                        connection_method, created_at, updated_at
                    ) VALUES (
                        :user_id, 'connected', :secret_ref, :fingerprint,
                        'test', NOW(), NOW()
                    )
                    RETURNING id
                    """
                ),
                {
                    "user_id": target_user_id,
                    "secret_ref": f"feed-secret-{suffix}",
                    "fingerprint": f"feed-fingerprint-{suffix}",
                },
            ).scalar_one()

    source = external_feeds.upsert_external_feed_source(
        source_kind="bandcamp_rss",
        source_url="https://followed-feed.bandcamp.com/feed",
        canonical_url="https://followed-feed.bandcamp.com",
        artist_id=artist_id,
        association_method="followed_artist",
        parser_version="bandcamp-rss-v1",
    )
    item = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url="https://followed-feed.bandcamp.com/feed",
        canonical_url="https://followed-feed.bandcamp.com/news/tour",
        external_guid="tour-1",
        title="Tour announcement",
        content_hash="tour-hash",
        parser_version="bandcamp-rss-v1",
        author="Followed Feed Artist",
        published_at=datetime(2026, 8, 23, 10, 0, tzinfo=timezone.utc),
        payload={"image_url": "https://followed-feed.bandcamp.com/tour.jpg"},
    )

    user_items = external_feeds.list_external_feed_items_for_user(user_id)
    assert user_items[0]["title"] == "Tour announcement"
    assert user_items[0]["accepted_enrichment_json"] is None

    enrichment = external_feeds.queue_external_feed_item_enrichment(
        item_id=item["id"],
        operation="summary",
        source_content_hash="tour-hash",
        prompt_version="external-feed-summary-v1",
    )
    external_feeds.mark_external_feed_enrichment_ready(
        enrichment["id"],
        result={
            "summary": "The band announced European tour dates.",
            "key_points": ["European tour"],
            "generated_at": "2026-08-23T12:00:00+00:00",
        },
        model="ollama/test",
        prompt_version="external-feed-summary-v1",
    )
    external_feeds.review_external_feed_enrichment(
        enrichment["id"], reviewer_id=1, decision="accept"
    )

    accepted_items = external_feeds.list_external_feed_items_for_user(user_id)
    assert accepted_items[0]["accepted_enrichment_json"]["summary"] == (
        "The band announced European tour dates."
    )
    assert accepted_items[0]["accepted_enrichment_model"] == "ollama/test"
    assert accepted_items[0]["accepted_enrichment_prompt_version"] == (
        "external-feed-summary-v1"
    )

    cluster_related = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="release",
        source_url="https://followed-feed.bandcamp.com/feed",
        canonical_url="https://followed-feed.bandcamp.com/album/tour",
        external_guid="tour-release-1",
        title="Tour release",
        content_hash="tour-release-hash",
        parser_version="bandcamp-rss-v1",
        author="Followed Feed Artist",
        published_at=datetime(2026, 8, 23, 11, 0, tzinfo=timezone.utc),
    )
    cluster_enrichment = external_feeds.queue_external_feed_item_enrichment(
        item_id=item["id"],
        operation="cluster",
        source_content_hash="tour-hash",
        prompt_version="external-feed-clustering-v1",
    )
    external_feeds.mark_external_feed_enrichment_ready(
        cluster_enrichment["id"],
        result={
            "cluster_type": "release",
            "members": [
                {
                    "item_id": item["id"],
                    "role": "representative",
                    "reason": "Introduces the release.",
                },
                {
                    "item_id": cluster_related["id"],
                    "role": "related",
                    "reason": "Covers the same release.",
                },
            ],
            "confidence": 0.9,
            "rationale": "Both items cover the same release.",
            "warnings": [],
        },
        model="ollama/test",
        prompt_version="external-feed-clustering-v1",
    )
    external_feeds.review_external_feed_enrichment(
        cluster_enrichment["id"], reviewer_id=1, decision="accept"
    )

    clustered_items = external_feeds.list_external_feed_items_for_user(user_id)
    cluster_context = next(
        context
        for row in clustered_items
        for context in row.get("feed_clusters", [])
        if context["enrichment_id"] == cluster_enrichment["id"]
    )
    assert cluster_context["applied"] is False
    assert {
        (member["id"], member["role"], member["visible"])
        for member in cluster_context["members"]
    } == {
        (item["id"], "representative", True),
        (cluster_related["id"], "related", True),
    }

    external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url="https://followed-feed.bandcamp.com/feed",
        canonical_url="https://followed-feed.bandcamp.com/news/tour",
        external_guid="tour-1",
        title="Tour announcement updated",
        content_hash="tour-hash-updated",
        parser_version="bandcamp-rss-v1",
        author="Followed Feed Artist",
        published_at=datetime(2026, 8, 23, 10, 0, tzinfo=timezone.utc),
        payload={"image_url": "https://followed-feed.bandcamp.com/tour.jpg"},
    )
    current_items = external_feeds.list_external_feed_items_for_user(user_id)
    assert current_items[0]["accepted_enrichment_json"] is None
    assert external_feeds.list_external_feed_items_for_user(other_user_id) == []

    with transaction_scope() as session:
        item_id = session.execute(
            text(
                """
                INSERT INTO bandcamp_items (
                    bandcamp_item_type, artist_name, item_url, artist_url,
                    first_seen_at, updated_at
                ) VALUES (
                    'artist', 'Followed Feed Artist',
                    'https://followed-feed.bandcamp.com',
                    'https://followed-feed.bandcamp.com', NOW(), NOW()
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
                "user_id": other_user_id,
                "connection_id": connection_ids[other_user_id],
                "item_id": item_id,
            },
        )

    wishlist_items = external_feeds.list_external_feed_items_for_user(other_user_id)
    assert {row["title"] for row in wishlist_items} == {
        "Tour announcement updated",
        "Tour release",
    }

    representative = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url="https://followed-feed.bandcamp.com/feed",
        canonical_url="https://followed-feed.bandcamp.com/news/tour-representative",
        external_guid="tour-representative",
        title="Representative tour announcement",
        content_hash="tour-representative-hash",
        parser_version="bandcamp-rss-v1",
        author="Followed Feed Artist",
        published_at=datetime(2026, 8, 23, 11, 0, tzinfo=timezone.utc),
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE external_feed_items
                SET duplicate_of_id = :representative_id
                WHERE external_guid IN ('tour-1', 'tour-release-1')
                """
            ),
            {"representative_id": representative["id"]},
        )

    visible_titles = [
        row["title"]
        for row in external_feeds.list_external_feed_items_for_user(user_id)
    ]
    assert visible_titles == ["Representative tour announcement"]

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE bandcamp_connections
                SET status = 'revoked', revoked_at = NOW()
                WHERE user_id = :user_id
                """
            ),
            {"user_id": user_id},
        )

    assert external_feeds.list_external_feed_items_for_user(user_id) == []


def test_external_feed_items_for_artist_keeps_explicit_associations_only(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import transaction_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Artist Updates Target"})
    pg_db.upsert_artist({"name": "Other Updates Artist"})
    with transaction_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Artist Updates Target'")
        ).scalar_one()
        other_artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Other Updates Artist'")
        ).scalar_one()
        user_id = session.execute(
            text(
                """
                INSERT INTO users (email, created_at)
                VALUES ('artist-updates@example.test', NOW())
                RETURNING id
                """
            )
        ).scalar_one()

    artist_source = external_feeds.upsert_external_feed_source(
        source_kind="artist_site",
        source_url="https://artist-updates.example/feed.xml",
        artist_id=artist_id,
        parser_version="artist-site-v1",
    )
    publisher_source = external_feeds.upsert_external_feed_source(
        source_kind="publisher_rss",
        source_scope="publisher",
        source_url="https://publisher-updates.example/feed.xml",
        parser_version="editorial-feed-v1",
    )
    bandcamp_source = external_feeds.upsert_external_feed_source(
        source_kind="bandcamp_rss",
        source_url="https://artist-updates.bandcamp.com/feed",
        artist_id=artist_id,
        parser_version="bandcamp-rss-v1",
    )

    external_feeds.upsert_external_feed_item(
        source_id=artist_source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=artist_source["source_url"],
        canonical_url="https://artist-updates.example/news/artist",
        external_guid="artist-news",
        title="Artist-site news",
        content_hash="artist-news-hash",
        parser_version="artist-site-v1",
    )
    external_feeds.upsert_external_feed_item(
        source_id=publisher_source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=publisher_source["source_url"],
        canonical_url="https://publisher-updates.example/news/artist",
        external_guid="publisher-news",
        title="Publisher news about the artist",
        content_hash="publisher-news-hash",
        parser_version="editorial-feed-v1",
    )
    external_feeds.upsert_external_feed_item(
        source_id=publisher_source["id"],
        artist_id=other_artist_id,
        item_kind="news",
        source_url=publisher_source["source_url"],
        canonical_url="https://publisher-updates.example/news/other",
        external_guid="other-news",
        title="Publisher news about another artist",
        content_hash="other-news-hash",
        parser_version="editorial-feed-v1",
    )
    external_feeds.upsert_external_feed_item(
        source_id=bandcamp_source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=bandcamp_source["source_url"],
        canonical_url="https://artist-updates.bandcamp.com/news/artist",
        external_guid="bandcamp-news",
        title="Bandcamp artist news",
        content_hash="bandcamp-news-hash",
        parser_version="bandcamp-rss-v1",
    )

    items = external_feeds.list_external_feed_items_for_artist(user_id, artist_id)

    assert [item["title"] for item in items] == [
        "Publisher news about the artist",
        "Artist-site news",
    ]


def test_external_feed_cluster_application_is_idempotent_and_reversible(pg_db):
    from crate.db.repositories import external_feeds
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Cluster Apply Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Cluster Apply Artist'")
        ).scalar_one()

    source = external_feeds.upsert_external_feed_source(
        source_kind="artist_site",
        source_url="https://cluster-apply.example/feed.xml",
        artist_id=artist_id,
        parser_version="cluster-apply-v1",
    )
    target = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="news",
        source_url=source["source_url"],
        canonical_url="https://cluster-apply.example/target",
        external_guid="cluster-apply-target",
        title="Album announcement",
        content_hash="cluster-apply-target-hash",
        parser_version="cluster-apply-v1",
    )
    related = external_feeds.upsert_external_feed_item(
        source_id=source["id"],
        artist_id=artist_id,
        item_kind="release",
        source_url=source["source_url"],
        canonical_url="https://cluster-apply.example/preorder",
        external_guid="cluster-apply-related",
        title="Album pre-order",
        content_hash="cluster-apply-related-hash",
        parser_version="cluster-apply-v1",
    )
    enrichment = external_feeds.queue_external_feed_item_enrichment(
        item_id=target["id"],
        operation="cluster",
        source_content_hash=target["content_hash"],
        prompt_version="external-feed-clustering-v1",
    )
    external_feeds.mark_external_feed_enrichment_ready(
        enrichment["id"],
        result={
            "operation": "cluster",
            "cluster_type": "release",
            "members": [
                {
                    "item_id": target["id"],
                    "role": "representative",
                    "reason": "The announcement introduces the release.",
                },
                {
                    "item_id": related["id"],
                    "role": "related",
                    "reason": "The pre-order covers the same release.",
                },
            ],
            "confidence": 0.9,
            "rationale": "Both items cover the same release campaign.",
            "warnings": [],
        },
        model="ollama/test",
        prompt_version="external-feed-clustering-v1",
    )
    external_feeds.review_external_feed_enrichment(
        enrichment["id"], reviewer_id=1, decision="accept"
    )

    applied = external_feeds.apply_external_feed_cluster_enrichment(
        enrichment["id"], applied_by_user_id=1
    )

    assert applied["representative_item_id"] == target["id"]
    assert applied["related_item_ids"] == [related["id"]]
    assert applied["already_applied"] is False
    assert external_feeds.list_external_feed_cluster_candidates(target["id"]) == []

    retried = external_feeds.apply_external_feed_cluster_enrichment(
        enrichment["id"], applied_by_user_id=1
    )
    assert retried["related_item_ids"] == [related["id"]]
    assert retried["already_applied"] is True

    reverted = external_feeds.revert_external_feed_cluster_enrichment(
        enrichment["id"], reverted_by_user_id=1
    )
    assert reverted["restored_item_ids"] == [related["id"]]
    assert reverted["already_reverted"] is False
    assert (
        external_feeds.list_external_feed_cluster_candidates(target["id"])[0]["id"]
        == related["id"]
    )

    retried_revert = external_feeds.revert_external_feed_cluster_enrichment(
        enrichment["id"], reverted_by_user_id=1
    )
    assert retried_revert["already_reverted"] is True


def test_global_publisher_source_is_not_bound_to_an_artist(pg_db):
    from crate.db.repositories import external_feeds

    source = external_feeds.upsert_external_feed_source(
        source_kind="publisher_rss",
        source_url="https://pitchfork.com/feed/rss",
        canonical_url="https://pitchfork.com/",
        display_name="Pitchfork",
        publisher_name="Pitchfork",
        category="music_news",
        language="es",
        source_scope="publisher",
        ai_policy="enabled",
        parser_version="editorial-feed-v1",
        refresh_interval_seconds=86400,
    )

    assert source["artist_id"] is None
    assert source["source_scope"] == "publisher"
    assert source["display_name"] == "Pitchfork"
    assert source["publisher_name"] == "Pitchfork"
    assert source["language"] == "es"
    assert source["refresh_interval_seconds"] == 86400

    listed = external_feeds.list_external_feed_sources(scope="publisher")
    assert any(row["id"] == source["id"] for row in listed)
