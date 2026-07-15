"""Read-only invariant reporting for the node-first user-reference backfill."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope


_INVARIANTS: dict[str, tuple[str, str, str]] = {
    "users": ("users", "id::text", "to_jsonb(item)"),
    "sessions": ("sessions", "id", "to_jsonb(item)"),
    "artist_follows": (
        "user_follows",
        "user_id::text || ':' || artist_name",
        "to_jsonb(item)",
    ),
    "album_saves": (
        "user_saved_albums",
        "user_id::text || ':' || album_id::text",
        "to_jsonb(item)",
    ),
    "track_likes": (
        "user_liked_tracks",
        "user_id::text || ':' || track_id::text",
        "to_jsonb(item)",
    ),
    "playlists": ("playlists", "id::text", "to_jsonb(item)"),
    "playlist_tracks": (
        "playlist_tracks",
        "id::text",
        "to_jsonb(item) - 'global_track_uid'",
    ),
    "play_events": (
        "user_play_events",
        "id::text",
        "to_jsonb(item) - 'global_track_uid'",
    ),
    "tasks": ("tasks", "id", "to_jsonb(item)"),
    "imports": ("federation_import_requests", "request_id::text", "to_jsonb(item)"),
    "peers": ("federation_nodes", "node_uid::text", "to_jsonb(item)"),
    "grants": ("federation_peer_grants", "id::text", "to_jsonb(item)"),
    "genres": ("genre_taxonomy_nodes", "id::text", "to_jsonb(item)"),
}


def _table_invariant(
    session,
    table: str,
    order_expression: str,
    payload_expression: str,
) -> dict[str, Any]:
    row = (
        session.execute(
            text(
                f"""
                SELECT
                    COUNT(*)::bigint AS count,
                    md5(COALESCE(
                        string_agg(({payload_expression})::text, '|' ORDER BY {order_expression}),
                        ''
                    )) AS digest
                FROM {table} AS item
                """
            )
        )
        .mappings()
        .one()
    )
    return {"count": int(row["count"]), "digest": str(row["digest"])}


def collect_federation_backfill_report(*, session=None) -> dict[str, Any]:
    """Return PII-free counts/hashes and unresolved canonical references."""
    with optional_scope(session) as current:
        revision = current.execute(
            text("SELECT version_num FROM alembic_version LIMIT 1")
        ).scalar_one()
        legacy = {
            name: _table_invariant(
                current,
                table,
                order_expression,
                payload_expression,
            )
            for name, (
                table,
                order_expression,
                payload_expression,
            ) in _INVARIANTS.items()
        }
        canonical = dict(
            current.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM user_global_artist_follows) AS artist_follows,
                        (SELECT COUNT(*) FROM user_global_album_saves) AS album_saves,
                        (SELECT COUNT(*) FROM user_global_track_likes) AS track_likes,
                        (SELECT COUNT(*) FROM playlist_tracks WHERE global_track_uid IS NOT NULL) AS playlist_tracks,
                        (SELECT COUNT(*) FROM user_play_events WHERE global_track_uid IS NOT NULL) AS play_events,
                        (SELECT COUNT(*) FROM global_catalog_sources WHERE source_kind = 'local') AS local_sources
                    """
                )
            )
            .mappings()
            .one()
        )
        canonical = {name: int(value or 0) for name, value in canonical.items()}
        unresolved = dict(
            current.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM user_follows legacy WHERE NOT EXISTS (
                            SELECT 1 FROM library_artists local_artist
                            JOIN global_catalog_artists global_artist
                              ON global_artist.local_artist_id = local_artist.id
                            WHERE lower(local_artist.name) = lower(legacy.artist_name)
                        )) AS artist_follows,
                        (SELECT COUNT(*) FROM user_saved_albums legacy WHERE NOT EXISTS (
                            SELECT 1 FROM global_catalog_albums item
                            WHERE item.local_album_id = legacy.album_id
                        )) AS album_saves,
                        (SELECT COUNT(*) FROM user_liked_tracks legacy WHERE NOT EXISTS (
                            SELECT 1 FROM global_catalog_tracks item
                            WHERE item.local_track_id = legacy.track_id
                        )) AS track_likes,
                        (SELECT COUNT(*) FROM playlist_tracks WHERE global_track_uid IS NULL) AS playlist_tracks,
                        (SELECT COUNT(*) FROM user_play_events WHERE global_track_uid IS NULL) AS play_events
                    """
                )
            )
            .mappings()
            .one()
        )
        unresolved = {name: int(value or 0) for name, value in unresolved.items()}
        state = dict(
            current.execute(
                text(
                    """
                    SELECT status, bootstrap_cursor_json, user_refs_backfill_version,
                           user_refs_backfilled_at, user_refs_backfill_report_json,
                           last_error
                    FROM global_catalog_state
                    WHERE singleton = TRUE
                    """
                )
            )
            .mappings()
            .one()
        )
    return {
        "schema_revision": str(revision),
        "legacy_invariants": legacy,
        "canonical_counts": canonical,
        "unresolved": unresolved,
        "catalog_state": state,
    }


__all__ = ["collect_federation_backfill_report"]
