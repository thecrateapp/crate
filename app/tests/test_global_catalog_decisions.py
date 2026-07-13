import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _insert_remote_artist(
    *,
    node_uid: str,
    remote_entity_uid: str,
    title: str,
    musicbrainz_artist_mbid: str | None = None,
):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_catalog_items
                    (
                        node_uid,
                        remote_entity_uid,
                        entity_type,
                        title,
                        musicbrainz_artist_mbid,
                        remote_revision,
                        raw_json
                    )
                VALUES
                    (
                        :node_uid,
                        :remote_entity_uid,
                        'artist',
                        :title,
                        :musicbrainz_artist_mbid,
                        'rev-1',
                        :raw_json
                    )
                """
            ),
            {
                "node_uid": node_uid,
                "remote_entity_uid": remote_entity_uid,
                "title": title,
                "musicbrainz_artist_mbid": musicbrainz_artist_mbid,
                "raw_json": json.dumps({"fixture": True}),
            },
        )


def _only_artist_uid():
    from crate.db.queries.global_catalog import list_global_sources

    [source] = list_global_sources()
    return source["global_entity_uid"]


def test_record_match_decision_audits_admin_user(pg_db):
    from crate.federation.global_decisions import record_match_decision

    decision = record_match_decision(
        entity_type="artist",
        decision_type="ignore_candidate",
        source_a={"match_key": "artist:local"},
        source_b={"match_key": "artist:remote"},
        reason="bad candidate",
        admin_user_id=7,
    )

    assert decision["decision_type"] == "ignore_candidate"
    assert decision["admin_user_id"] == 7
    assert decision["reason"] == "bad candidate"


def test_force_merge_decision_overrides_remote_artist_scoring(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_decisions import record_match_decision
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "High Vis"})
    reconcile_local_catalog()
    local_uid = _only_artist_uid()
    _insert_remote_artist(
        node_uid=node_uid,
        remote_entity_uid="artist-remote",
        title="High Viz",
    )
    record_match_decision(
        entity_type="artist",
        decision_type="force_merge",
        source_a={"global_entity_uid": local_uid},
        source_b={"match_key": "artist:high viz"},
        target_global_uid=local_uid,
        admin_user_id=7,
    )

    reconcile_remote_catalog()

    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 0,
        "tracks": 0,
        "sources": 2,
    }


def test_force_split_decision_blocks_automatic_name_merge(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_decisions import record_match_decision
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Rival Schools"})
    reconcile_local_catalog()
    local_uid = _only_artist_uid()
    _insert_remote_artist(
        node_uid=node_uid,
        remote_entity_uid="artist-remote",
        title="Rival Schools",
    )
    record_match_decision(
        entity_type="artist",
        decision_type="force_split",
        source_a={"global_entity_uid": local_uid},
        source_b={"match_key": "artist:rival schools"},
        target_global_uid=local_uid,
        admin_user_id=7,
    )

    reconcile_remote_catalog()

    assert get_global_catalog_counts() == {
        "artists": 2,
        "albums": 0,
        "tracks": 0,
        "sources": 2,
    }
