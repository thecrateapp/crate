"""Every health check publishes a truthful finite repair contract."""

import pytest

from crate.repair_catalog import REPAIR_CATALOG_BY_CHECK
from crate.repair_contracts import repair_contracts


MANUAL_CHECKS = {
    "duplicate_folders",
    "canonical_mismatch",
    "artist_layout_fix",
    "unindexed_files",
    "folder_naming",
    "missing_cover",
}
AUTOMATIC_CHECKS = {
    "fk_orphan_albums",
    "fk_orphan_tracks",
    "stale_artists",
    "stale_albums",
    "stale_tracks",
    "zombie_artists",
    "has_photo_desync",
    "duplicate_albums",
    "duplicate_tracks",
    "shadow_quality_tracks",
    "tag_mismatch",
}
DESTRUCTIVE_CHECKS = {
    "fk_orphan_albums",
    "fk_orphan_tracks",
    "stale_artists",
    "stale_albums",
    "stale_tracks",
    "zombie_artists",
    "duplicate_tracks",
    "shadow_quality_tracks",
}


def test_repair_contract_catalog_has_one_complete_contract_for_every_check():
    contracts = repair_contracts()
    assert len(contracts) == 17
    assert {entry["check_type"] for entry in contracts} == set(REPAIR_CATALOG_BY_CHECK)
    assert MANUAL_CHECKS | AUTOMATIC_CHECKS == set(REPAIR_CATALOG_BY_CHECK)
    assert not MANUAL_CHECKS & AUTOMATIC_CHECKS
    assert all(
        entry["reason"] and entry["preconditions"] and entry["verification"]
        for entry in contracts
    )
    assert all(entry["supports_global_scope"] is False for entry in contracts)
    assert all(entry["limits"]["issues"] == 20 for entry in contracts)
    assert all(entry["effects"]["external_providers"] is False for entry in contracts)


@pytest.mark.parametrize("check", sorted(MANUAL_CHECKS | AUTOMATIC_CHECKS))
def test_each_check_distinguishes_manual_variants_and_destructive_approval(check):
    contract = next(
        entry for entry in repair_contracts() if entry["check_type"] == check
    )
    assert contract["support"] == ("manual" if check in MANUAL_CHECKS else "automatic")
    assert contract["executable"] is (check in AUTOMATIC_CHECKS)
    if check in MANUAL_CHECKS:
        assert contract["supports_batch"] is False
        assert contract["effects"]["database"] is False
        assert contract["effects"]["filesystem"] is False
    if check in DESTRUCTIVE_CHECKS:
        assert contract["risk"] == "destructive"
        assert contract["approval_required"] is True
    assert contract["effects"]["filesystem"] is (
        check in {"duplicate_tracks", "shadow_quality_tracks"}
    )


def test_conditional_automatic_variants_explain_their_narrow_execution_contract():
    contracts = {entry["check_type"]: entry for entry in repair_contracts()}
    assert "stable UIDs" in contracts["duplicate_albums"]["reason"]
    assert "file hashes" in contracts["duplicate_tracks"]["reason"]
    assert "canonical indexed copy" in contracts["shadow_quality_tracks"]["reason"]
