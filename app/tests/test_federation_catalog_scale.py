from __future__ import annotations

import inspect
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_manifest_query_is_keyset_only_and_bounded():
    from crate.db.queries import federation_manifest

    source = inspect.getsource(federation_manifest.list_federation_manifest_rows)
    normalized = " ".join(source.upper().split())

    assert " OFFSET " not in f" {normalized} "
    sql_templates = " ".join(
        federation_manifest._entity_page_sql(entity_type).upper()
        for entity_type in ("album", "artist", "track")
    )
    assert "UNION ALL" not in sql_templates
    assert sql_templates.count("> CAST(NULLIF(:AFTER_ENTITY_UID, '') AS UUID)") == 3
    assert sql_templates.count("LIMIT :LIMIT") == 3


def test_manifest_indexes_exist_for_all_local_entity_uids():
    migration = (
        ROOT / "app/crate/db/migrations/versions/016_entity_uids.py"
    ).read_text()

    for table in ("library_artists", "library_albums", "library_tracks"):
        assert f"ON {table}(entity_uid)" in migration


def test_catalog_page_byte_budget_is_independent_of_catalog_size():
    from crate.api.federation import _cap_catalog_items_by_bytes

    items = [
        {"entity_type": "track", "remote_entity_uid": str(index), "title": "x" * 80}
        for index in range(48_000)
    ]
    bounded, truncated = _cap_catalog_items_by_bytes(items, max_bytes=4_096)

    assert truncated is True
    assert 0 < len(bounded) < len(items)
    assert len(json.dumps(bounded, separators=(",", ":")).encode()) <= 4_096


def test_catalog_byte_budget_rejects_one_oversized_item():
    import pytest

    from crate.api.federation import _cap_catalog_items_by_bytes

    with pytest.raises(ValueError, match="single catalog item"):
        _cap_catalog_items_by_bytes(
            [{"entity_type": "track", "payload": "x" * 8_192}],
            max_bytes=1_024,
        )
