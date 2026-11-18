from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import text

from crate.db.tx import read_scope

_EXPORT_COLUMNS = """
    id, user_id, status, task_id, filename, bytes, error,
    created_at, completed_at, expires_at
"""

USER_DATA_EXPORT_SECTIONS: tuple[tuple[str, str], ...] = (
    (
        "profile",
        """
        SELECT id, email, username, name, bio, avatar, role, status,
               created_at, last_login, timezone, pulse_listed, instagram_handle,
               city, country, country_code, latitude, longitude,
               show_location_mode, show_radius_km,
               crate_connect_enabled, remote_scrobbling_enabled
        FROM users
        WHERE id = :user_id
        """,
    ),
    (
        "roles",
        """
        SELECT role, assigned_at
        FROM user_roles
        WHERE user_id = :user_id
        ORDER BY role
        """,
    ),
    (
        "connected_accounts",
        """
        SELECT provider, external_user_id, external_username, status,
               created_at, updated_at, last_synced_at
        FROM user_external_identities
        WHERE user_id = :user_id
        ORDER BY provider
        """,
    ),
    (
        "sessions",
        """
        SELECT created_at, last_seen_at, expires_at, revoked_at,
               last_seen_ip, user_agent, app_id, device_label
        FROM sessions
        WHERE user_id = :user_id
        ORDER BY created_at
        """,
    ),
    (
        "devices",
        """
        SELECT device_label, device_type, app_platform, app_version,
               created_at, last_seen_at, revoked_at
        FROM user_devices
        WHERE user_id = :user_id
        ORDER BY created_at
        """,
    ),
    (
        "access_tokens",
        """
        SELECT name, token_type, token_prefix, scopes,
               created_at, expires_at, revoked_at, last_used_at
        FROM user_access_tokens
        WHERE user_id = :user_id
        ORDER BY created_at
        """,
    ),
    (
        "playlists",
        """
        SELECT id, name, description, scope, visibility, is_collaborative,
               is_smart, smart_rules_json, generation_mode, track_count,
               total_duration, created_at, updated_at
        FROM playlists
        WHERE user_id = :user_id
        ORDER BY id
        """,
    ),
    (
        "playlist_tracks",
        """
        SELECT pt.playlist_id, pt.position, pt.title, pt.artist, pt.album,
               pt.duration, pt.track_entity_uid, pt.global_track_uid, pt.added_at
        FROM playlist_tracks pt
        JOIN playlists p ON p.id = pt.playlist_id
        WHERE p.user_id = :user_id
        ORDER BY pt.playlist_id, pt.position, pt.id
        """,
    ),
    (
        "playlist_memberships",
        """
        SELECT pm.playlist_id, p.name AS playlist_name, pm.role, pm.created_at
        FROM playlist_members pm
        JOIN playlists p ON p.id = pm.playlist_id
        WHERE pm.user_id = :user_id
        ORDER BY pm.created_at, pm.playlist_id
        """,
    ),
    (
        "followed_playlists",
        """
        SELECT f.playlist_id, p.name AS playlist_name, f.followed_at
        FROM user_followed_playlists f
        JOIN playlists p ON p.id = f.playlist_id
        WHERE f.user_id = :user_id
        ORDER BY f.followed_at, f.playlist_id
        """,
    ),
    (
        "crates",
        """
        SELECT id, name, description, visibility, is_collaborative,
               is_ordered, sort_direction, loop_enabled, short_code,
               created_at, updated_at
        FROM crates
        WHERE owner_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "crate_albums",
        """
        SELECT ca.crate_id, ca.position, ca.global_album_uid,
               a.canonical_name AS album, a.artist_name AS artist, ca.added_at
        FROM crate_albums ca
        JOIN crates c ON c.id = ca.crate_id
        LEFT JOIN global_catalog_albums a ON a.global_album_uid = ca.global_album_uid
        WHERE c.owner_id = :user_id
        ORDER BY ca.crate_id, ca.position
        """,
    ),
    (
        "crate_memberships",
        """
        SELECT m.crate_id, c.name AS crate_name, m.created_at
        FROM crate_members m
        JOIN crates c ON c.id = m.crate_id
        WHERE m.user_id = :user_id
        ORDER BY m.created_at, m.crate_id
        """,
    ),
    (
        "followed_crates",
        """
        SELECT f.crate_id, c.name AS crate_name, f.followed_at
        FROM crate_followers f
        JOIN crates c ON c.id = f.crate_id
        WHERE f.user_id = :user_id
        ORDER BY f.followed_at, f.crate_id
        """,
    ),
    (
        "liked_tracks",
        """
        SELECT l.track_id, t.entity_uid AS track_entity_uid, t.title, t.artist,
               t.album, l.created_at
        FROM user_liked_tracks l
        LEFT JOIN library_tracks t ON t.id = l.track_id
        WHERE l.user_id = :user_id
        ORDER BY l.created_at, l.track_id
        """,
    ),
    (
        "liked_catalog_tracks",
        """
        SELECT l.global_track_uid, t.canonical_title AS title, t.artist_name AS artist,
               t.album_name AS album, l.created_at
        FROM user_global_track_likes l
        LEFT JOIN global_catalog_tracks t ON t.global_track_uid = l.global_track_uid
        WHERE l.user_id = :user_id
        ORDER BY l.created_at, l.global_track_uid
        """,
    ),
    (
        "saved_albums",
        """
        SELECT s.album_id, a.entity_uid AS album_entity_uid, a.name AS album,
               a.artist, s.created_at
        FROM user_saved_albums s
        LEFT JOIN library_albums a ON a.id = s.album_id
        WHERE s.user_id = :user_id
        ORDER BY s.created_at, s.album_id
        """,
    ),
    (
        "saved_catalog_albums",
        """
        SELECT s.global_album_uid, a.canonical_name AS album, a.artist_name AS artist,
               s.created_at
        FROM user_global_album_saves s
        LEFT JOIN global_catalog_albums a ON a.global_album_uid = s.global_album_uid
        WHERE s.user_id = :user_id
        ORDER BY s.created_at, s.global_album_uid
        """,
    ),
    (
        "followed_artists",
        """
        SELECT artist_name, created_at
        FROM user_follows
        WHERE user_id = :user_id
        ORDER BY created_at, artist_name
        """,
    ),
    (
        "followed_catalog_artists",
        """
        SELECT f.global_artist_uid, a.canonical_name AS artist, f.created_at
        FROM user_global_artist_follows f
        LEFT JOIN global_catalog_artists a ON a.global_artist_uid = f.global_artist_uid
        WHERE f.user_id = :user_id
        ORDER BY f.created_at, f.global_artist_uid
        """,
    ),
    (
        "track_ratings",
        """
        SELECT r.track_id, r.global_track_uid, t.title, t.artist, t.album,
               r.rating, r.updated_at
        FROM user_track_ratings r
        LEFT JOIN library_tracks t ON t.id = r.track_id
        WHERE r.user_id = :user_id
        ORDER BY r.updated_at
        """,
    ),
    (
        "favorites",
        """
        SELECT item_type, item_id, created_at
        FROM favorites
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "play_events",
        """
        SELECT started_at, ended_at, title, artist, album, track_entity_uid,
               global_track_uid, played_seconds, track_duration_seconds,
               completion_ratio, was_skipped, was_completed, play_source_type,
               play_source_id, play_source_name, context_artist, context_album,
               context_playlist_id, device_type, app_platform, content_origin
        FROM user_play_events
        WHERE user_id = :user_id
        ORDER BY started_at, id
        """,
    ),
    (
        "play_history",
        """
        SELECT played_at, title, artist, album, track_entity_uid
        FROM play_history
        WHERE user_id = :user_id
        ORDER BY played_at, id
        """,
    ),
    (
        "show_attendance",
        """
        SELECT a.show_id, s.artist_name, s.venue, s.city, s.country, s.date,
               a.created_at
        FROM user_show_attendance a
        LEFT JOIN shows s ON s.id = a.show_id
        WHERE a.user_id = :user_id
        ORDER BY a.created_at, a.id
        """,
    ),
    (
        "show_reminders",
        """
        SELECT show_id, reminder_type, created_at, triggered_at
        FROM user_show_reminders
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "following_users",
        """
        SELECT u.username, r.created_at
        FROM user_relationships r
        JOIN users u ON u.id = r.followed_user_id
        WHERE r.follower_user_id = :user_id
        ORDER BY r.created_at, r.followed_user_id
        """,
    ),
    (
        "equalizer_presets",
        """
        SELECT label, scope, target_type, target_entity_uid, gains, source,
               created_at, updated_at
        FROM equalizer_presets
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "contributions",
        """
        SELECT source, artist_name, album_name, album_entity_uid, status,
               imported_at, withdrawn_at
        FROM library_contributions
        WHERE user_id = :user_id
        ORDER BY imported_at, id
        """,
    ),
    (
        "decks_corrections",
        """
        SELECT entity_uid, bpm, key, beat_grid_format, revision, updated_at
        FROM user_track_corrections
        WHERE user_id = :user_id
        ORDER BY updated_at, entity_uid
        """,
    ),
    (
        "decks_cues",
        """
        SELECT entity_uid, cue_type, slot, start_ms, end_ms, label, color,
               revision, updated_at
        FROM user_track_cues
        WHERE user_id = :user_id
        ORDER BY entity_uid, cue_type, slot
        """,
    ),
    (
        "smart_mix_playlists",
        """
        SELECT playlist_id, enabled, enabled_at, disabled_at, last_used_at
        FROM smart_mix_playlists
        WHERE user_id = :user_id
        ORDER BY playlist_id
        """,
    ),
    (
        "recommendation_feedback",
        """
        SELECT surface, entity_type, entity_key, action, strength, reason,
               created_at, updated_at, expires_at
        FROM user_recommendation_feedback
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "radio_feedback",
        """
        SELECT track_id, action, created_at
        FROM radio_feedback
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "music_paths",
        """
        SELECT name, origin_type, origin_value, origin_label, dest_type,
               dest_value, dest_label, step_count, created_at, updated_at
        FROM music_paths
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "bandcamp_connections",
        """
        SELECT username, display_name, status, connection_method,
               created_at, last_sync_at, revoked_at
        FROM bandcamp_connections
        WHERE user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "bandcamp_items",
        """
        SELECT bandcamp_item_id, relation_type, owned, downloadable,
               purchase_date, added_at, removed_at
        FROM user_bandcamp_items
        WHERE user_id = :user_id
        ORDER BY added_at, id
        """,
    ),
    (
        "artist_suggestions",
        """
        SELECT artist_name, artist_url, note, status, created_at, resolved_at
        FROM artist_suggestions
        WHERE created_by_user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
    (
        "jam_rooms",
        """
        SELECT id, name, description, status, visibility, created_at, ended_at
        FROM jam_rooms
        WHERE host_user_id = :user_id
        ORDER BY created_at, id
        """,
    ),
)

_SECTION_SQL = dict(USER_DATA_EXPORT_SECTIONS)


def iter_user_data_export_rows(
    user_id: int, section: str, *, batch_size: int = 500
) -> Iterator[dict]:
    sql = _SECTION_SQL[section]
    with read_scope() as session:
        result = session.execute(
            text(sql).execution_options(yield_per=batch_size),
            {"user_id": user_id},
        ).mappings()
        for row in result:
            yield dict(row)


def get_latest_user_data_export(user_id: int, *, session=None) -> dict | None:
    def _impl(current) -> dict | None:
        row = (
            current.execute(
                text(
                    f"""
                    SELECT {_EXPORT_COLUMNS}
                    FROM user_data_exports
                    WHERE user_id = :user_id
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row is not None else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_user_data_export(
    export_id: str, *, user_id: int | None = None, session=None
) -> dict | None:
    def _impl(current) -> dict | None:
        row = (
            current.execute(
                text(
                    f"""
                    SELECT {_EXPORT_COLUMNS}
                    FROM user_data_exports
                    WHERE id = :export_id
                      AND (CAST(:user_id AS INTEGER) IS NULL OR user_id = :user_id)
                    """
                ),
                {"export_id": export_id, "user_id": user_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row is not None else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "USER_DATA_EXPORT_SECTIONS",
    "get_latest_user_data_export",
    "get_user_data_export",
    "iter_user_data_export_rows",
]
