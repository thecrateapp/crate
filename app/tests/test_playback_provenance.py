from __future__ import annotations

from datetime import timedelta
import json
import uuid

import pytest
from sqlalchemy import text

from crate.db.tx import transaction_scope


def test_playback_session_round_trip_binds_user_track_and_source(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-playback-provenance-secret-32")

    from crate.playback_provenance import (
        PlaybackSessionInvalid,
        issue_playback_session,
        verify_playback_session,
    )

    token = issue_playback_session(
        user_id=7,
        global_track_uid="11111111-1111-4111-8111-111111111111",
        content_origin="remote",
        source_node_uid="22222222-2222-4222-8222-222222222222",
    )

    claims = verify_playback_session(
        token,
        user_id=7,
        global_track_uid="11111111-1111-4111-8111-111111111111",
    )
    assert claims.content_origin == "remote"
    assert claims.source_node_uid == "22222222-2222-4222-8222-222222222222"

    with pytest.raises(PlaybackSessionInvalid):
        verify_playback_session(token, user_id=8)


def test_playback_session_rejects_invalid_origin_and_expired_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-playback-provenance-secret-32")

    from crate.playback_provenance import (
        PlaybackSessionInvalid,
        issue_playback_session,
        verify_playback_session,
    )

    with pytest.raises(ValueError, match="source node"):
        issue_playback_session(user_id=7, content_origin="remote")

    token = issue_playback_session(
        user_id=7,
        content_origin="local",
        lifetime=timedelta(seconds=-1),
    )
    with pytest.raises(PlaybackSessionInvalid):
        verify_playback_session(token, user_id=7)


def test_local_content_provenance_recognizes_completed_federation_import(pg_db):
    from crate.playback_provenance import resolve_local_content_provenance

    pg_db.upsert_artist({"name": "High Vis"})
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "High Vis",
            "album": "Blending",
            "filename": "01 - Talk For Hours.flac",
            "title": "Talk For Hours",
            "path": "/music/High Vis/Blending/01 - Talk For Hours.flac",
        }
    )
    track_id = pg_db.get_library_tracks(album_id)[0]["id"]
    source_node_uid = "22222222-2222-4222-8222-222222222222"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_import_requests (
                    request_id, node_uid, remote_entity_uid, title, status,
                    idempotency_key, metadata_json, completed_at
                ) VALUES (
                    :request_id, CAST(:node_uid AS uuid), 'remote-album',
                    'Blending', 'completed', :idempotency_key,
                    CAST(:metadata AS jsonb), NOW()
                )
                """
            ),
            {
                "request_id": str(uuid.uuid4()),
                "node_uid": source_node_uid,
                "idempotency_key": str(uuid.uuid4()),
                "metadata": json.dumps({"provenance": {"local_album_id": album_id}}),
            },
        )

    assert resolve_local_content_provenance(track_id) == (
        "imported",
        source_node_uid,
    )
    assert resolve_local_content_provenance(999_999) == ("local", None)
