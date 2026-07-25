import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_local_genre_assignment_projects_attributed_global_membership(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import core_genre_uid

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Taxonomy Artist", "entity_uid": artist_uid})
    pg_db.set_artist_genres("Taxonomy Artist", [("hardcore", 0.8, "test")])

    result = reconcile_dirty_catalog_sources(limit=10)
    assert result["completed"] == 1

    with read_scope() as session:
        assertion = (
            session.execute(
                text(
                    """
                    SELECT
                        assertion.global_genre_uid::text AS global_genre_uid,
                        assertion.mapping_method,
                        assertion.raw_label,
                        assertion.invalidated_at IS NULL AS active
                    FROM global_catalog_genre_assertions assertion
                    JOIN global_catalog_sources source ON source.id = assertion.source_id
                    WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                    """
                ),
                {"artist_uid": artist_uid},
            )
            .mappings()
            .one()
        )
        membership = (
            session.execute(
                text(
                    """
                    SELECT
                        supporting_source_count,
                        supporting_node_count,
                        direct_score::double precision AS direct_score
                    FROM global_catalog_entity_genres
                    WHERE entity_type = 'artist'
                      AND global_genre_uid = CAST(:genre_uid AS uuid)
                    """
                ),
                {"genre_uid": core_genre_uid("hardcore-punk")},
            )
            .mappings()
            .one()
        )

    assert assertion == {
        "global_genre_uid": core_genre_uid("hardcore-punk"),
        "mapping_method": "local_alias",
        "raw_label": "hardcore",
        "active": True,
    }
    assert membership == {
        "supporting_source_count": 1,
        "supporting_node_count": 1,
        "direct_score": 0.8,
    }


def test_legacy_alias_does_not_project_global_membership(pg_db):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Legacy Alias Artist", "entity_uid": artist_uid})
    with transaction_scope() as session:
        rock_id = session.execute(
            text(
                """
                SELECT id
                FROM genre_taxonomy_nodes
                WHERE taxonomy_id = 'crate-core' AND slug = 'rock'
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_aliases (
                    alias_slug, alias_name, genre_id, origin, confidence
                )
                VALUES ('scene-country', 'scene country', :genre_id, 'legacy', NULL)
                """
            ),
            {"genre_id": rock_id},
        )
    pg_db.set_artist_genres(
        "Legacy Alias Artist",
        [("scene country", 1.0, "test")],
    )

    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with read_scope() as session:
        assertion = (
            session.execute(
                text(
                    """
                    SELECT
                        assertion.global_genre_uid,
                        assertion.mapping_method
                    FROM global_catalog_genre_assertions assertion
                    JOIN global_catalog_sources source ON source.id = assertion.source_id
                    WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                      AND assertion.invalidated_at IS NULL
                    """
                ),
                {"artist_uid": artist_uid},
            )
            .mappings()
            .one()
        )
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres membership
                JOIN global_catalog_sources source
                  ON source.entity_type = membership.entity_type
                 AND source.global_entity_uid = membership.global_entity_uid
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()

    assert assertion == {
        "global_genre_uid": None,
        "mapping_method": "unmapped",
    }
    assert memberships == 0


def test_repair_stale_alias_assertions_recomputes_affected_entity(pg_db):
    from crate.db.jobs.global_catalog_genres import repair_stale_alias_assertions
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Removed Alias Artist", "entity_uid": artist_uid})
    with transaction_scope() as session:
        rock_id = session.execute(
            text(
                """
                SELECT id
                FROM genre_taxonomy_nodes
                WHERE taxonomy_id = 'crate-core' AND slug = 'rock'
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_aliases (
                    alias_slug, alias_name, genre_id, origin, confidence
                )
                VALUES ('temporary-scene', 'temporary scene', :genre_id, 'manual', 1.0)
                """
            ),
            {"genre_id": rock_id},
        )
    pg_db.set_artist_genres(
        "Removed Alias Artist",
        [("temporary scene", 1.0, "test")],
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with transaction_scope() as session:
        session.execute(
            text(
                "DELETE FROM genre_taxonomy_aliases WHERE alias_slug = 'temporary-scene'"
            )
        )
        repaired = repair_stale_alias_assertions(session)

    assert repaired == {"assertions": 1, "entities": 1}
    with read_scope() as session:
        active_assertions = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_genre_assertions assertion
                JOIN global_catalog_sources source ON source.id = assertion.source_id
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                  AND assertion.invalidated_at IS NULL
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres membership
                JOIN global_catalog_sources source
                  ON source.entity_type = membership.entity_type
                 AND source.global_entity_uid = membership.global_entity_uid
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()

    assert active_assertions == 0
    assert memberships == 0


def test_repair_waits_until_a_legacy_alias_is_removed(pg_db):
    from crate.db.jobs.global_catalog_genres import repair_stale_alias_assertions
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Pending Seed Artist", "entity_uid": artist_uid})
    with transaction_scope() as session:
        rock_id = session.execute(
            text(
                """
                SELECT id
                FROM genre_taxonomy_nodes
                WHERE taxonomy_id = 'crate-core' AND slug = 'rock'
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_aliases (
                    alias_slug, alias_name, genre_id, origin, confidence
                )
                VALUES ('pending-seed', 'pending seed', :genre_id, 'manual', 1.0)
                """
            ),
            {"genre_id": rock_id},
        )
    pg_db.set_artist_genres(
        "Pending Seed Artist",
        [("pending seed", 1.0, "test")],
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE genre_taxonomy_aliases
                SET origin = 'legacy', confidence = NULL
                WHERE alias_slug = 'pending-seed'
                """
            )
        )
        repaired = repair_stale_alias_assertions(session)

    assert repaired == {"assertions": 0, "entities": 0}
    with read_scope() as session:
        active_assertions = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_genre_assertions assertion
                JOIN global_catalog_sources source ON source.id = assertion.source_id
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                  AND assertion.invalidated_at IS NULL
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres membership
                JOIN global_catalog_sources source
                  ON source.entity_type = membership.entity_type
                 AND source.global_entity_uid = membership.global_entity_uid
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()

    assert active_assertions == 1
    assert memberships == 1


def test_taxonomy_seed_repairs_assertions_for_removed_legacy_aliases(pg_db):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import seed_genre_taxonomy

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Seed Repair Artist", "entity_uid": artist_uid})
    with transaction_scope() as session:
        rock_id = session.execute(
            text(
                """
                SELECT id
                FROM genre_taxonomy_nodes
                WHERE taxonomy_id = 'crate-core' AND slug = 'rock'
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_aliases (
                    alias_slug, alias_name, genre_id, origin, confidence
                )
                VALUES ('removed-by-seed', 'removed by seed', :genre_id, 'manual', 1.0)
                """
            ),
            {"genre_id": rock_id},
        )
    pg_db.set_artist_genres(
        "Seed Repair Artist",
        [("removed by seed", 1.0, "test")],
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE genre_taxonomy_aliases
                SET origin = 'legacy', confidence = NULL
                WHERE alias_slug = 'removed-by-seed'
                """
            )
        )
        seed_genre_taxonomy(session)

    with read_scope() as session:
        active_assertions = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_genre_assertions assertion
                JOIN global_catalog_sources source ON source.id = assertion.source_id
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                  AND assertion.invalidated_at IS NULL
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres membership
                JOIN global_catalog_sources source
                  ON source.entity_type = membership.entity_type
                 AND source.global_entity_uid = membership.global_entity_uid
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()

    assert active_assertions == 0
    assert memberships == 0


def test_changing_local_genres_requeues_only_that_catalog_source(pg_db):
    from crate.db.repositories.genres_assignments import set_artist_genres
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import core_genre_uid

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Requeued Genre Artist", "entity_uid": artist_uid})
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    set_artist_genres("Requeued Genre Artist", [("hardcore", 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with read_scope() as session:
        membership = session.execute(
            text(
                """
                SELECT supporting_source_count
                FROM global_catalog_entity_genres
                WHERE entity_type = 'artist'
                  AND global_genre_uid = CAST(:genre_uid AS uuid)
                """
            ),
            {"genre_uid": core_genre_uid("hardcore-punk")},
        ).scalar_one()

    assert membership == 1


def test_unknown_remote_taxonomy_is_retained_without_global_membership(pg_db):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_genres import project_source_genre_assertions

    global_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists (
                    global_artist_uid, canonical_name, sort_name, normalized_name
                )
                VALUES (CAST(:global_uid AS uuid), 'Remote Genre Artist',
                        'Remote Genre Artist', 'remote genre artist')
                """
            ),
            {"global_uid": global_uid},
        )
        source_id = session.execute(
            text(
                """
                INSERT INTO global_catalog_sources (
                    entity_type, global_entity_uid, source_kind, node_uid,
                    remote_entity_uid, match_key
                )
                VALUES (
                    'artist', CAST(:global_uid AS uuid), 'federated',
                    CAST(:node_uid AS uuid), 'remote-artist', 'remote-artist'
                )
                RETURNING id
                """
            ),
            {"global_uid": global_uid, "node_uid": str(uuid.uuid4())},
        ).scalar_one()
        project_source_genre_assertions(
            session,
            source_id=int(source_id),
            entity_type="artist",
            global_entity_uid=global_uid,
            source_kind="federated",
            source_revision="remote-revision",
            assertions=[
                {
                    "raw_label": "unknown-remote-label",
                    "taxonomy": {
                        "id": "remote-taxonomy",
                        "version": "1.0.0",
                        "digest": "sha256:unknown",
                    },
                }
            ],
        )

    with read_scope() as session:
        assertion = (
            session.execute(
                text(
                    """
                SELECT global_genre_uid, mapping_method, invalidated_at IS NULL AS active
                FROM global_catalog_genre_assertions
                WHERE source_id = :source_id
                """
                ),
                {"source_id": source_id},
            )
            .mappings()
            .one()
        )
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres
                WHERE entity_type = 'artist'
                  AND global_entity_uid = CAST(:global_uid AS uuid)
                """
            ),
            {"global_uid": global_uid},
        ).scalar_one()

    assert assertion == {
        "global_genre_uid": None,
        "mapping_method": "unmapped",
        "active": True,
    }
    assert memberships == 0


def test_tombstoned_source_removes_its_global_genre_membership(pg_db):
    from crate.db.repositories.library_enrichment_writes import delete_artist
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Deleted Genre Artist", "entity_uid": artist_uid})
    pg_db.set_artist_genres("Deleted Genre Artist", [("hardcore", 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    delete_artist("Deleted Genre Artist")
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with read_scope() as session:
        active_assertions = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_genre_assertions assertion
                JOIN global_catalog_sources source ON source.id = assertion.source_id
                WHERE source.local_entity_uid = CAST(:artist_uid AS uuid)
                  AND assertion.invalidated_at IS NULL
                """
            ),
            {"artist_uid": artist_uid},
        ).scalar_one()
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres
                WHERE entity_type = 'artist'
                """
            )
        ).scalar_one()

    assert active_assertions == 0
    assert memberships == 0


def test_tombstoned_peer_source_removes_its_global_genre_membership(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.catalog import tombstone_catalog_item, upsert_catalog_item
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import core_genre_uid

    node_uid = str(uuid.uuid4())
    upsert_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="remote-genre-artist",
        entity_type="artist",
        title="Remote Genre Artist",
        raw_json={"genres": ["hardcore"]},
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    tombstone_catalog_item(node_uid, "remote-genre-artist", "artist")
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    with read_scope() as session:
        memberships = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_entity_genres
                WHERE entity_type = 'artist'
                  AND global_genre_uid = CAST(:genre_uid AS uuid)
                """
            ),
            {"genre_uid": core_genre_uid("hardcore-punk")},
        ).scalar_one()

    assert memberships == 0


def test_global_genre_snapshots_share_the_exact_core_descriptor(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_genres import refresh_global_catalog_genre_snapshots
    from crate.genre_taxonomy import get_core_taxonomy_descriptor

    refresh_global_catalog_genre_snapshots()

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT scope, payload_json
                FROM ui_snapshots
                WHERE scope IN ('global-catalog-taxonomy', 'global-catalog-genres')
                  AND subject_key = 'crate-core'
                ORDER BY scope
                """
                )
            )
            .mappings()
            .all()
        )

    descriptor = get_core_taxonomy_descriptor()
    expected = {
        "id": descriptor["taxonomy_id"],
        "version": descriptor["version"],
        "digest": descriptor["digest"],
    }
    assert len(rows) == 2
    assert all(row["payload_json"]["taxonomy"] == expected for row in rows)


def test_admin_global_catalog_status_exposes_taxonomy_without_peer_raw_labels(pg_db):
    from crate.api.admin_global_catalog import get_global_catalog_admin_status

    status = get_global_catalog_admin_status()

    assert status["state"]["status"] == "cold"
    assert status["taxonomy"]["id"] == "crate-core"
    assert status["genre_projection"] == {
        "active_assertions": 0,
        "unmapped_assertions": 0,
        "memberships": 0,
    }
