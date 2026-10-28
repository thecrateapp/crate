"""Published execution readiness for every persisted library health check."""

from crate.repair_catalog import REPAIR_CATALOG


def _overlapping_targets(items: list[dict]) -> bool:
    seen = set()
    for item in items:
        keys = {
            (target["entity_type"], target["entity_uid"]) for target in item["targets"]
        }
        if seen.intersection(keys):
            return True
        seen.update(keys)
    return False


_MANUAL = {
    "duplicate_folders": "Folder merges require a complete collision and non-audio file manifest; no merge is executed by this contract.",
    "canonical_mismatch": "Artist renames may merge identities, genres and artwork; an explicit merge decision is required.",
    "artist_layout_fix": "Layout migration may discover more files than its legacy preview; prepare and review the dedicated migration in Admin.",
    "unindexed_files": "Unindexed discovery may merge folders and enrich an artist. Use an explicit library sync plan for already indexed entities.",
    "folder_naming": "Legacy naming collisions can delete lower quality files and non-audio contents; resolve the collision in Admin.",
    "missing_cover": "A cover must be selected and staged with verified identity and bytes before an automatic write is safe.",
    "edition_overlap": "Overlapping editions can both be intended; keep, quarantine or dismiss each edition from the album view.",
    "album_split_folders": "Tracks outside their album folder need the artist layout fix in Admin, which moves files under review.",
}
_CONDITIONAL = {
    "duplicate_albums": "Automatic only for indexed copies with stable UIDs; quarantine marks duplicate album rows and preserves all audio.",
    "duplicate_tracks": "Automatic only for an exact same-album group with identical current file hashes; cached acoustic fingerprints do not prove equivalence. Frozen keep/drop selection moves files into quarantine.",
    "shadow_quality_tracks": "Automatic only with a verified canonical indexed copy and malformed rows outside that folder; quarantine preserves removed audio.",
    "fk_orphan_albums": "Reassign to the unique case-insensitive canonical artist, otherwise delete the frozen orphan album and its declared dependents.",
}


def repair_contracts() -> list[dict]:
    result = []
    for entry in REPAIR_CATALOG:
        manual = entry.check_type in _MANUAL
        filesystem = entry.check_type in {"duplicate_tracks", "shadow_quality_tracks"}
        destructive = entry.check_type in {
            "fk_orphan_albums",
            "fk_orphan_tracks",
            "stale_artists",
            "stale_albums",
            "stale_tracks",
            "zombie_artists",
            "duplicate_tracks",
            "shadow_quality_tracks",
        }
        result.append(
            {
                "check_type": entry.check_type,
                "support": "manual" if manual else "automatic",
                "executable": not manual,
                "reason": _MANUAL.get(entry.check_type)
                or _CONDITIONAL.get(entry.check_type)
                or "Exact canonical issue and UID targets are revalidated in the worker.",
                "targets": "persisted issue IDs resolved to local entity UIDs",
                "limits": {
                    "issues": 20,
                    "tracks_per_issue": 200,
                    "dependent_rows_per_relation": 200,
                },
                "supports_batch": not manual,
                "batch_constraint": "Only nonoverlapping entity scopes; overlapping items require separate reviewed plans.",
                "supports_global_scope": False,
                "preconditions": [
                    "open canonical issue",
                    "complete source version",
                    "exact target membership",
                    "current authorization",
                    "file absence or SHA-256 where applicable",
                ],
                "effects": {
                    "database": not manual,
                    "filesystem": filesystem,
                    "external_providers": False,
                    "cascades": destructive,
                },
                "risk": "destructive" if destructive else entry.risk,
                "approval_required": destructive,
                "retry": "A started delivery is not repeated; inspect effects and prepare a fresh plan.",
                "cancel": "Cooperative checkpoints between items; completed effects remain applied.",
                "verification": "Source CAS, affected row postconditions and quarantine file hashes; an issue resolves only after its postcondition passes.",
                "reversibility": "Quarantined audio is preserved; deleted DB metadata and dependent relationships require restoration from backup or a new explicit import."
                if destructive
                else "New plan or unquarantine album in Admin",
            }
        )
    return result


__all__ = ["repair_contracts"]
