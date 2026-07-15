from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from sqlalchemy import text


def test_database_confirmation_fails_closed(monkeypatch):
    from crate.db.core_provisioning import confirm_database_target

    monkeypatch.setenv("CRATE_POSTGRES_DB", "crate_test")

    assert confirm_database_target("crate_test") == "crate_test"
    try:
        confirm_database_target("crate")
    except ValueError as exc:
        assert "does not match" in str(exc)
    else:
        raise AssertionError("wrong database confirmation must fail")


def test_legacy_user_data_survives_canonical_backfill_end_to_end(pg_db):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs,
    )
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.backfill_verification import (
        collect_federation_backfill_report,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    artist_entity_uid = str(uuid.uuid4())
    album_entity_uid = str(uuid.uuid4())
    track_entity_uid = str(uuid.uuid4())
    pg_db.upsert_artist(
        {"name": "High Vis", "entity_uid": artist_entity_uid, "slug": "high-vis"}
    )
    pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "entity_uid": album_entity_uid,
            "slug": "blending",
        }
    )
    pg_db.upsert_track(
        {
            "artist": "High Vis",
            "album": "Blending",
            "title": "Talk for Hours",
            "filename": "01 - Talk for Hours.flac",
            "path": "/music/High Vis/Blending/01 - Talk for Hours.flac",
            "entity_uid": track_entity_uid,
            "duration": 180,
        }
    )
    reconcile_local_catalog()

    peer_uid = str(uuid.uuid4())
    request_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        album_id = session.execute(
            text("SELECT id FROM library_albums WHERE entity_uid = CAST(:uid AS uuid)"),
            {"uid": album_entity_uid},
        ).scalar_one()
        track_id = session.execute(
            text("SELECT id FROM library_tracks WHERE entity_uid = CAST(:uid AS uuid)"),
            {"uid": track_entity_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO sessions (id, user_id, expires_at, created_at)
                VALUES ('upgrade-session', 1, :expires_at, NOW())
                """
            ),
            {"expires_at": datetime.now(timezone.utc) + timedelta(days=1)},
        )
        session.execute(
            text(
                "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (1, 'High Vis', NOW())"
            )
        )
        session.execute(
            text(
                "INSERT INTO user_saved_albums (user_id, album_id, created_at) VALUES (1, :album_id, NOW())"
            ),
            {"album_id": album_id},
        )
        session.execute(
            text(
                "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (1, :track_id, NOW())"
            ),
            {"track_id": track_id},
        )
        playlist_id = session.execute(
            text(
                "INSERT INTO playlists (name, user_id, created_at, updated_at) VALUES ('Legacy', 1, NOW(), NOW()) RETURNING id"
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks
                    (playlist_id, track_id, track_entity_uid, track_path, title,
                     artist, album, duration, position, added_at)
                VALUES
                    (:playlist_id, :track_id, CAST(:track_uid AS uuid), '/music/legacy.flac',
                     'Talk for Hours', 'High Vis', 'Blending', 180, 1, NOW())
                """
            ),
            {
                "playlist_id": playlist_id,
                "track_id": track_id,
                "track_uid": track_entity_uid,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO user_play_events
                    (user_id, track_id, track_entity_uid, title, artist, album,
                     started_at, ended_at, played_seconds, created_at)
                VALUES
                    (1, :track_id, CAST(:track_uid AS uuid), 'Talk for Hours',
                     'High Vis', 'Blending', NOW() - INTERVAL '3 minutes', NOW(), 180, NOW())
                """
            ),
            {"track_id": track_id, "track_uid": track_entity_uid},
        )
        session.execute(
            text(
                "INSERT INTO tasks (id, type, status, created_at, updated_at) VALUES ('legacy-task', 'sync', 'completed', NOW(), NOW())"
            )
        )
        session.execute(
            text(
                """
                INSERT INTO federation_nodes
                    (node_uid, display_name, api_base_url, active_key_id,
                     trust_state, default_grant_preset)
                VALUES
                    (CAST(:peer_uid AS uuid), 'Pending legacy peer',
                     'https://peer.example.test', 'key-1', 'pending', 'discovery')
                """
            ),
            {"peer_uid": peer_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO federation_import_requests
                    (request_id, node_uid, remote_entity_uid, title, status,
                     requested_by_user_id, idempotency_key)
                VALUES
                    (CAST(:request_uid AS uuid), CAST(:peer_uid AS uuid),
                     'remote-album', 'Remote album', 'awaiting_approval', 1,
                     'upgrade-legacy-import')
                """
            ),
            {"request_uid": request_uid, "peer_uid": peer_uid},
        )

    before = collect_federation_backfill_report()
    result = backfill_legacy_user_library_refs()
    after = collect_federation_backfill_report()

    assert before["legacy_invariants"] == after["legacy_invariants"]
    assert result["unresolved_artist_follows"] == 0
    assert result["unresolved_album_saves"] == 0
    assert result["unresolved_track_likes"] == 0
    assert result["unresolved_playlist_tracks"] == 0
    assert result["unresolved_play_events"] == 0
    expected_canonical_counts = {
        "artist_follows": 1,
        "album_saves": 1,
        "track_likes": 1,
        "playlist_tracks": 1,
        "play_events": 1,
    }
    for name, expected in expected_canonical_counts.items():
        assert after["canonical_counts"][name] == expected
    with read_scope() as session:
        preserved = (
            session.execute(
                text(
                    """
                SELECT
                    EXISTS(SELECT 1 FROM sessions WHERE id = 'upgrade-session') AS session,
                    EXISTS(SELECT 1 FROM tasks WHERE id = 'legacy-task') AS task,
                    EXISTS(
                        SELECT 1 FROM federation_import_requests
                        WHERE request_id = CAST(:request_uid AS uuid)
                    ) AS import_request
                """
                ),
                {"request_uid": request_uid},
            )
            .mappings()
            .one()
        )
        peer = (
            session.execute(
                text(
                    "SELECT trust_state, default_grant_preset FROM federation_nodes WHERE node_uid = CAST(:uid AS uuid)"
                ),
                {"uid": peer_uid},
            )
            .mappings()
            .one()
        )
    assert all(preserved.values())
    assert dict(peer) == {"trust_state": "pending", "default_grant_preset": "discovery"}
