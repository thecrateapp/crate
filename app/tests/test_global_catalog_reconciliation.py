import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local_catalog(pg_db):
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())

    pg_db.upsert_artist(
        {
            "name": "High Vis",
            "entity_uid": artist_uid,
            "mbid": "artist-mbid",
            "has_photo": 1,
        }
    )
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "entity_uid": album_uid,
            "musicbrainz_albumid": "release-mbid",
            "year": "2022",
            "track_count": 1,
            "total_duration": 183.0,
            "has_cover": 1,
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
            "entity_uid": track_uid,
            "musicbrainz_trackid": "recording-mbid",
            "duration": 183.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )
    return artist_uid, album_uid, track_uid


def test_reconcile_local_catalog_creates_canonical_rows_and_sources(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_catalog(pg_db)

    result = reconcile_local_catalog(batch_size=1)

    assert result["status"] == "completed"
    assert result["source_rows_seen"] == 3
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }
    assert {source["entity_type"] for source in list_global_sources()} == {
        "artist",
        "album",
        "track",
    }


def test_local_reconciliation_batch_is_bounded_and_resumable(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_reconciliation import reconcile_local_catalog_batch

    _seed_local_catalog(pg_db)

    cursor = None
    batches = []
    while True:
        result = reconcile_local_catalog_batch(batch_size=1, cursor=cursor)
        batches.append(result)
        assert result["source_rows_seen"] <= 1
        if result["completed"]:
            break
        cursor = result["next_cursor"]

    assert len(batches) > 1
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }


def test_reconcile_local_catalog_is_idempotent(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_catalog(pg_db)

    first = reconcile_local_catalog()
    second = reconcile_local_catalog()

    assert first["source_rows_seen"] == 3
    assert second["source_rows_seen"] == 3
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }


def test_full_match_recompute_rebinds_recording_mbid_without_unique_violation(
    pg_db,
):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_local_catalog_batch,
    )

    pg_db.upsert_artist(
        {
            "name": "Pulp",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    original_album_id = pg_db.upsert_album(
        {
            "artist": "Pulp",
            "name": "Different Class",
            "path": "/music/Pulp/Different Class",
            "entity_uid": str(uuid.uuid4()),
            "year": "1995",
            "track_count": 1,
        }
    )
    deluxe_album_id = pg_db.upsert_album(
        {
            "artist": "Pulp",
            "name": "Different Class (Deluxe Edition)",
            "path": "/music/Pulp/Different Class (Deluxe Edition)",
            "entity_uid": str(uuid.uuid4()),
            "year": "1995",
            "track_count": 1,
        }
    )
    original_track_path = "/music/Pulp/Different Class/01 - Mis-Shapes.flac"
    pg_db.upsert_track(
        {
            "album_id": original_album_id,
            "artist": "Pulp",
            "album": "Different Class",
            "filename": "01 - Mis-Shapes.flac",
            "title": "Mis-Shapes",
            "path": original_track_path,
            "entity_uid": str(uuid.uuid4()),
            "duration": 227.0,
            "disc_number": 1,
            "track_number": 1,
        }
    )
    deluxe_track_path = (
        "/music/Pulp/Different Class (Deluxe Edition)/01 - Mis-Shapes.flac"
    )
    pg_db.upsert_track(
        {
            "album_id": deluxe_album_id,
            "artist": "Pulp",
            "album": "Different Class (Deluxe Edition)",
            "filename": "01 - Mis-Shapes.flac",
            "title": "Mis-Shapes",
            "path": deluxe_track_path,
            "entity_uid": str(uuid.uuid4()),
            "musicbrainz_trackid": "recording-mbid",
            "duration": 235.0,
            "disc_number": 1,
            "track_number": 1,
        }
    )
    with read_scope() as session:
        track_ids = (
            session.execute(
                text(
                    """
                    SELECT id
                    FROM library_tracks
                    WHERE path = ANY(:paths)
                    ORDER BY path
                    """
                ),
                {"paths": [original_track_path, deluxe_track_path]},
            )
            .scalars()
            .all()
        )
    original_track_id, deluxe_track_id = sorted(track_ids)
    reconcile_local_catalog()

    with read_scope() as session:
        initial_sources = (
            session.execute(
                text(
                    """
                    SELECT
                        local_id,
                        global_entity_uid::text AS global_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'track'
                      AND local_id = ANY(:track_ids)
                    ORDER BY local_id
                    """
                ),
                {"track_ids": [original_track_id, deluxe_track_id]},
            )
            .mappings()
            .all()
        )
    assert len({row["global_entity_uid"] for row in initial_sources}) == 2

    replacement_entity_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET duration = 227,
                    entity_uid = CAST(:entity_uid AS uuid)
                WHERE id = :track_id
                """
            ),
            {
                "entity_uid": replacement_entity_uid,
                "track_id": deluxe_track_id,
            },
        )
        session.execute(
            text(
                """
                UPDATE global_catalog_sources
                SET local_entity_uid = CAST(:entity_uid AS uuid)
                WHERE entity_type = 'track'
                  AND local_id = :track_id
                """
            ),
            {
                "entity_uid": replacement_entity_uid,
                "track_id": deluxe_track_id,
            },
        )

    cursor = None
    while True:
        batch = reconcile_local_catalog_batch(
            batch_size=1,
            cursor=cursor,
            recompute_matches=True,
        )
        if batch["completed"]:
            break
        cursor = batch["next_cursor"]

    with read_scope() as session:
        reconciled_sources = (
            session.execute(
                text(
                    """
                    SELECT global_entity_uid::text AS global_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'track'
                      AND local_id = ANY(:track_ids)
                    ORDER BY local_id
                    """
                ),
                {"track_ids": [original_track_id, deluxe_track_id]},
            )
            .scalars()
            .all()
        )
        recording_mbid = session.execute(
            text(
                """
                SELECT musicbrainz_recording_mbid
                FROM global_catalog_tracks
                WHERE global_track_uid = CAST(:global_uid AS uuid)
                """
            ),
            {"global_uid": reconciled_sources[0]},
        ).scalar_one()

    assert len(set(reconciled_sources)) == 1
    assert recording_mbid == "recording-mbid"


def test_full_match_recompute_splits_sources_that_no_longer_match(pg_db):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_local_catalog_batch,
    )

    pg_db.upsert_artist(
        {
            "name": "Underworld",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    album_ids = [
        pg_db.upsert_album(
            {
                "artist": "Underworld",
                "name": title,
                "path": f"/music/Underworld/{title}",
                "entity_uid": str(uuid.uuid4()),
                "year": "2019",
                "track_count": 5,
            }
        )
        for title in ('DRIFT Episode 1 "DUST"', 'DRIFT Episode 2 "ATOM"')
    ]
    reconcile_local_catalog()

    with read_scope() as session:
        source_rows = (
            session.execute(
                text(
                    """
                    SELECT id, local_id, global_entity_uid::text AS global_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'album'
                      AND local_id = ANY(:album_ids)
                    ORDER BY local_id
                    """
                ),
                {"album_ids": album_ids},
            )
            .mappings()
            .all()
        )
    assert len({row["global_entity_uid"] for row in source_rows}) == 2

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_sources
                SET global_entity_uid = CAST(:wrong_uid AS uuid)
                WHERE id = :source_id
                """
            ),
            {
                "wrong_uid": source_rows[0]["global_entity_uid"],
                "source_id": source_rows[1]["id"],
            },
        )

    cursor = None
    while True:
        batch = reconcile_local_catalog_batch(
            batch_size=1,
            cursor=cursor,
            recompute_matches=True,
        )
        if batch["completed"]:
            break
        cursor = batch["next_cursor"]

    with read_scope() as session:
        repaired = (
            session.execute(
                text(
                    """
                    SELECT
                        global_entity_uid::text AS global_entity_uid,
                        match_key
                    FROM global_catalog_sources
                    WHERE entity_type = 'album'
                      AND local_id = ANY(:album_ids)
                    ORDER BY local_id
                    """
                ),
                {"album_ids": album_ids},
            )
            .mappings()
            .all()
        )

    assert len({row["global_entity_uid"] for row in repaired}) == 2
    assert [row["match_key"] for row in repaired] == [
        "album:underworld|drift episode 1 dust|2019",
        "album:underworld|drift episode 2 atom|2019",
    ]


def test_full_match_recompute_splits_mixed_clusters_into_valid_subgroups(pg_db):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_local_catalog_batch,
    )

    pg_db.upsert_artist(
        {
            "name": "Dead Can Dance",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    titles = [
        "Live at the Acropolis",
        "Live at the Acropolis (Deluxe Edition)",
        "Live in Paris",
        "Live in Paris (Deluxe Edition)",
    ]
    album_ids = [
        pg_db.upsert_album(
            {
                "artist": "Dead Can Dance",
                "name": title,
                "path": f"/music/Dead Can Dance/{title}",
                "entity_uid": str(uuid.uuid4()),
                "year": "2021",
                "track_count": 10,
            }
        )
        for title in titles
    ]
    reconcile_local_catalog()

    with read_scope() as session:
        sources = (
            session.execute(
                text(
                    """
                    SELECT id, local_id, global_entity_uid::text AS global_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'album'
                      AND local_id = ANY(:album_ids)
                    ORDER BY local_id
                    """
                ),
                {"album_ids": album_ids},
            )
            .mappings()
            .all()
        )
    wrong_uid = sources[0]["global_entity_uid"]
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_sources
                SET global_entity_uid = CAST(:wrong_uid AS uuid)
                WHERE id = ANY(:source_ids)
                """
            ),
            {
                "wrong_uid": wrong_uid,
                "source_ids": [row["id"] for row in sources],
            },
        )

    cursor = None
    while True:
        batch = reconcile_local_catalog_batch(
            batch_size=1,
            cursor=cursor,
            recompute_matches=True,
        )
        if batch["completed"]:
            break
        cursor = batch["next_cursor"]

    with read_scope() as session:
        repaired = (
            session.execute(
                text(
                    """
                    SELECT local_id, global_entity_uid::text AS global_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'album'
                      AND local_id = ANY(:album_ids)
                    ORDER BY local_id
                    """
                ),
                {"album_ids": album_ids},
            )
            .mappings()
            .all()
        )

    targets = {row["local_id"]: row["global_entity_uid"] for row in repaired}
    assert targets[album_ids[0]] == targets[album_ids[1]]
    assert targets[album_ids[2]] == targets[album_ids[3]]
    assert targets[album_ids[0]] != targets[album_ids[2]]


def test_local_album_resolves_artist_through_merged_local_source(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    shared_mbid = str(uuid.uuid4())
    pg_db.upsert_artist(
        {
            "name": "Emma Ruth Rundle",
            "entity_uid": str(uuid.uuid4()),
            "mbid": shared_mbid,
        }
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (
                    entity_uid, name, slug, folder_name, album_count, track_count,
                    total_size, formats_json, has_photo, mbid, updated_at
                )
                VALUES (
                    CAST(:entity_uid AS uuid), :name, :slug, :name, 0, 0,
                    0, '[]'::jsonb, 0, :mbid, NOW()
                )
                """
            ),
            {
                "entity_uid": str(uuid.uuid4()),
                "name": "Emma Ruth Rundle & Thou",
                "slug": "emma-ruth-rundle-and-thou",
                "mbid": shared_mbid,
            },
        )
    album_id = pg_db.upsert_album(
        {
            "artist": "Emma Ruth Rundle",
            "name": "Engine of Hell",
            "path": "/music/Emma Ruth Rundle/Engine of Hell",
            "entity_uid": str(uuid.uuid4()),
            "track_count": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Emma Ruth Rundle",
            "album": "Engine of Hell",
            "filename": "01 - Return.flac",
            "title": "Return",
            "path": "/music/Emma Ruth Rundle/Engine of Hell/01 - Return.flac",
            "entity_uid": str(uuid.uuid4()),
            "duration": 246.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )

    result = reconcile_local_catalog()

    with read_scope() as session:
        canonical_artist = (
            session.execute(
                text(
                    """
                    SELECT canonical_name, source_count
                    FROM global_catalog_artists
                    """
                )
            )
            .mappings()
            .one()
        )

    assert result["source_rows_seen"] == 4
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 4,
    }
    assert canonical_artist == {
        "canonical_name": "Emma Ruth Rundle",
        "source_count": 2,
    }


def test_local_track_resolves_album_through_merged_local_source(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    pg_db.upsert_artist(
        {
            "name": "Alias Artist",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    shared_release_mbid = str(uuid.uuid4())
    original_album_id = pg_db.upsert_album(
        {
            "artist": "Alias Artist",
            "name": "Original Title",
            "path": "/music/Alias Artist/Original Title",
            "entity_uid": str(uuid.uuid4()),
            "musicbrainz_albumid": shared_release_mbid,
            "track_count": 1,
        }
    )
    pg_db.upsert_album(
        {
            "artist": "Alias Artist",
            "name": "Renamed Edition",
            "path": "/music/Alias Artist/Renamed Edition",
            "entity_uid": str(uuid.uuid4()),
            "musicbrainz_albumid": shared_release_mbid,
            "track_count": 1,
        }
    )
    track_uid = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "album_id": original_album_id,
            "artist": "Alias Artist",
            "album": "Original Title",
            "filename": "01 - Source Bound.flac",
            "title": "Source Bound",
            "path": "/music/Alias Artist/Original Title/01 - Source Bound.flac",
            "entity_uid": track_uid,
            "duration": 180.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )

    reconcile_local_catalog()

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        track.global_album_uid::text AS track_album_uid,
                        source.global_entity_uid::text AS source_album_uid
                    FROM global_catalog_tracks track
                    JOIN global_catalog_sources track_source
                      ON track_source.global_entity_uid = track.global_track_uid
                     AND track_source.entity_type = 'track'
                    JOIN global_catalog_sources source
                      ON source.source_kind = 'local'
                     AND source.entity_type = 'album'
                     AND source.local_id = :album_id
                    WHERE track_source.local_entity_uid = CAST(:track_uid AS uuid)
                    """
                ),
                {"album_id": original_album_id, "track_uid": track_uid},
            )
            .mappings()
            .one()
        )

    assert row["track_album_uid"] == row["source_album_uid"]


@pytest.mark.parametrize("reconciliation_mode", ["full", "incremental"])
def test_local_track_uses_album_artist_when_track_credit_is_not_canonical(
    pg_db, reconciliation_mode
):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import (
        reconcile_dirty_catalog_sources,
        reconcile_local_catalog,
    )

    pg_db.upsert_artist(
        {
            "name": "The Who",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    album_id = pg_db.upsert_album(
        {
            "artist": "The Who",
            "name": "Who Came First",
            "path": "/music/The Who/Who Came First",
            "entity_uid": str(uuid.uuid4()),
            "track_count": 1,
        }
    )
    track_uid = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Pete Townshend",
            "album": "Who Came First",
            "filename": "01 - Pure And Easy.flac",
            "title": "Pure And Easy",
            "path": "/music/The Who/Who Came First/01 - Pure And Easy.flac",
            "entity_uid": track_uid,
            "duration": 333.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )

    if reconciliation_mode == "full":
        reconcile_local_catalog()
    else:
        result = reconcile_dirty_catalog_sources(limit=10)
        assert result["failed"] == 0
        assert result["remaining"] == 0

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        track.global_artist_uid::text AS track_artist_uid,
                        album.global_artist_uid::text AS album_artist_uid
                    FROM global_catalog_sources source
                    JOIN global_catalog_tracks track
                      ON track.global_track_uid = source.global_entity_uid
                    JOIN global_catalog_albums album
                      ON album.global_album_uid = track.global_album_uid
                    WHERE source.source_kind = 'local'
                      AND source.entity_type = 'track'
                      AND source.local_entity_uid = CAST(:track_uid AS uuid)
                    """
                ),
                {"track_uid": track_uid},
            )
            .mappings()
            .one_or_none()
        )

    assert row is not None
    assert row["track_artist_uid"] == row["album_artist_uid"]


def test_full_local_reconciliation_prunes_a_source_missing_from_write_model(pg_db):
    from sqlalchemy import text

    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Deleted Outside Queue", "entity_uid": artist_uid})
    reconcile_local_catalog()
    with transaction_scope() as session:
        session.execute(
            text(
                "DELETE FROM library_artists WHERE entity_uid = CAST(:entity_uid AS uuid)"
            ),
            {"entity_uid": artist_uid},
        )

    reconcile_local_catalog()

    with read_scope() as session:
        source = (
            session.execute(
                text(
                    """
                    SELECT source_stale, source_deleted_at
                    FROM global_catalog_sources
                    WHERE local_entity_uid = CAST(:entity_uid AS uuid)
                    """
                ),
                {"entity_uid": artist_uid},
            )
            .mappings()
            .one()
        )
    assert get_global_catalog_counts()["artists"] == 0
    assert source["source_stale"] is True
    assert source["source_deleted_at"] is not None


def test_reconcile_local_catalog_prefers_local_sources(pg_db):
    from crate.db.queries.global_catalog import list_global_sources
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_catalog(pg_db)

    reconcile_local_catalog()

    sources = list_global_sources()
    assert len(sources) == 3
    for source in sources:
        assert source["source_kind"] == "local"
        assert source["preferred_for_display"] is True
        assert source["preferred_for_artwork"] is True
        assert source["preferred_for_playback"] is True


def test_full_reconciliation_run_lifecycle_persists_batch_totals(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import (
        begin_global_catalog_reconciliation_run,
        complete_global_catalog_reconciliation_run,
        record_global_catalog_reconciliation_batch,
    )

    run_id = begin_global_catalog_reconciliation_run(mode="full")
    record_global_catalog_reconciliation_batch(
        run_id,
        {
            "source_rows_seen": 500,
            "sources_upserted": 498,
            "canonical_created": 2,
            "canonical_updated": 496,
            "auto_merged": 7,
            "ambiguous_candidates": 3,
        },
    )
    complete_global_catalog_reconciliation_run(run_id)

    with read_scope() as session:
        run = (
            session.execute(
                text(
                    """
                    SELECT
                        status,
                        source_rows_seen,
                        sources_upserted,
                        canonical_created,
                        canonical_updated,
                        auto_merged,
                        ambiguous_candidates,
                        completed_at
                    FROM global_catalog_reconciliation_runs
                    WHERE run_id = CAST(:run_id AS uuid)
                    """
                ),
                {"run_id": run_id},
            )
            .mappings()
            .one()
        )

    assert run["status"] == "completed"
    assert run["source_rows_seen"] == 500
    assert run["sources_upserted"] == 498
    assert run["canonical_created"] == 2
    assert run["canonical_updated"] == 496
    assert run["auto_merged"] == 7
    assert run["ambiguous_candidates"] == 3
    assert run["completed_at"] is not None


def test_full_reconciliation_run_failure_is_persisted(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import (
        begin_global_catalog_reconciliation_run,
        fail_global_catalog_reconciliation_run,
    )

    run_id = begin_global_catalog_reconciliation_run(mode="full")
    fail_global_catalog_reconciliation_run(run_id, "projection failed")

    with read_scope() as session:
        run = (
            session.execute(
                text(
                    """
                    SELECT status, error, completed_at
                    FROM global_catalog_reconciliation_runs
                    WHERE run_id = CAST(:run_id AS uuid)
                    """
                ),
                {"run_id": run_id},
            )
            .mappings()
            .one()
        )

    assert run["status"] == "failed"
    assert run["error"] == "projection failed"
    assert run["completed_at"] is not None
