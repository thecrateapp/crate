from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE
from tests.test_global_catalog_user_refs import _seed_global_artist_and_album


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_track(pg_db, *, local: bool) -> tuple[str, int | None]:
    from crate.db.tx import transaction_scope

    artist_uid, album_uid = _seed_global_artist_and_album(pg_db)
    track_uid = str(uuid.uuid4())
    track_id: int | None = None
    track_entity_uid = str(uuid.uuid4())
    if local:
        pg_db.upsert_track(
            {
                "artist": "High Vis",
                "album": "Blending",
                "filename": "01 - Trauma Bonds.flac",
                "title": "Trauma Bonds",
                "path": "/music/High Vis/Blending/01 - Trauma Bonds.flac",
                "entity_uid": track_entity_uid,
                "duration": 180,
            }
        )
        with transaction_scope() as session:
            track_id = int(
                session.execute(
                    text(
                        "SELECT id FROM library_tracks "
                        "WHERE entity_uid = CAST(:uid AS uuid)"
                    ),
                    {"uid": track_entity_uid},
                ).scalar_one()
            )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks (
                    global_track_uid, global_album_uid, global_artist_uid,
                    canonical_title, normalized_title, artist_name, album_name,
                    duration_seconds, local_track_id, local_track_entity_uid,
                    has_local, has_remote, availability_json
                ) VALUES (
                    :track_uid, :album_uid, :artist_uid,
                    'Trauma Bonds', 'trauma bonds', 'High Vis', 'Blending',
                    180, :track_id, CAST(:track_entity_uid AS uuid),
                    :local, :remote,
                    jsonb_build_object('local', :local, 'remote', :remote)
                )
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "artist_uid": artist_uid,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid if local else None,
                "local": local,
                "remote": not local,
            },
        )
    return track_uid, track_id


def test_remote_only_like_uses_global_identity_and_survives_unavailability(pg_db):
    from crate.db.queries.user_library_library import get_liked_tracks
    from crate.db.repositories.user_library_preferences import like_track, unlike_track
    from crate.db.tx import transaction_scope

    track_uid, _ = _seed_track(pg_db, local=False)

    assert like_track(1, global_track_uid=track_uid) is True
    assert like_track(1, global_track_uid=track_uid) is False
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_tracks
                SET has_remote = false, availability_json = '{"remote": false}'::jsonb
                WHERE global_track_uid = CAST(:uid AS uuid)
                """
            ),
            {"uid": track_uid},
        )

    liked = get_liked_tracks(1)
    assert len(liked) == 1
    assert liked[0]["global_track_uid"] == track_uid
    assert liked[0]["track_id"] is None
    assert liked[0]["availability"]["remote"] is False
    assert unlike_track(1, global_track_uid=track_uid) is True


def test_local_like_dual_writes_without_double_counting(pg_db):
    from crate.db.queries.user_library_library import get_liked_tracks
    from crate.db.repositories.global_user_library import get_user_global_library_counts
    from crate.db.repositories.user_library_preferences import like_track
    from crate.db.tx import transaction_scope

    track_uid, track_id = _seed_track(pg_db, local=True)
    assert track_id is not None

    assert like_track(1, track_id=track_id) is True
    with transaction_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM user_liked_tracks WHERE user_id = 1")
            ).scalar_one()
            == 1
        )
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM user_global_track_likes WHERE user_id = 1")
            ).scalar_one()
            == 1
        )

    assert [item["global_track_uid"] for item in get_liked_tracks(1)] == [track_uid]
    assert get_user_global_library_counts(1)["liked_tracks"] == 1
