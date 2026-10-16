"""Task types whose library effects invalidate filesystem quality observations."""

from crate.task_registry import TASK_TYPES


QUALITY_MUTATING_TASK_TYPES = frozenset(
    task_type
    for task_type, info in TASK_TYPES.items()
    if info.category == "library"
    and task_type
    not in {
        "health_check",
        "scan",
        "quality_check",
        "export_rich_metadata",
        "agent_maintenance",
        "prepare_library_repairs",
    }
) | frozenset(
    {
        "tidal_download",
        "soulseek_download",
        "library_upload",
        "import_queue_item",
        "import_queue_all",
        "remux_m4a_dash",
        "bandcamp_import_purchase",
        "bandcamp_withdraw_contribution",
        "bandcamp_cleanup_user_contributions",
        "library_withdraw_contribution",
        "library_cleanup_user_contributions",
        "federation_import_album",
        "enrich_mbids",
        "rematch_album_mbids",
    }
)
