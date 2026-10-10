"""Canonical task type catalog: labels, categories and manual actions.

Single source of truth for task names. Used by API responses, the admin
task catalog endpoint and the Telegram bot.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TaskTypeInfo:
    label: str
    category: str


@dataclass(frozen=True)
class TaskAction:
    id: str
    label: str
    task_type: str
    path: str
    capability: str
    icon: str
    body: dict | None = None


TASK_CATEGORIES: dict[str, str] = {
    "library": "Library",
    "acquisition": "Acquisition",
    "federation": "Federation",
    "enrichment": "Enrichment",
    "analysis": "Analysis",
    "artwork": "Artwork",
    "playback": "Playback",
    "playlists": "Playlists",
}

TASK_TYPES: dict[str, TaskTypeInfo] = {
    "library_sync": TaskTypeInfo("Library Scan", "library"),
    "library_pipeline": TaskTypeInfo("Library Pipeline", "library"),
    "scan": TaskTypeInfo("Health Check", "library"),
    "health_check": TaskTypeInfo("Health Check", "library"),
    "fix_issues": TaskTypeInfo("Fix Health Issues", "library"),
    "repair": TaskTypeInfo("Library Repair", "library"),
    "repair_duplicate_tracks": TaskTypeInfo("Duplicate Track Cleanup", "library"),
    "resolve_duplicates": TaskTypeInfo("Resolve Duplicates", "library"),
    "process_new_content": TaskTypeInfo("Process New Content", "library"),
    "batch_retag": TaskTypeInfo("Batch Retag", "library"),
    "delete_artist": TaskTypeInfo("Artist Deletion", "library"),
    "delete_album": TaskTypeInfo("Album Deletion", "library"),
    "library_track_quarantine": TaskTypeInfo("Quarantine Track", "library"),
    "library_track_restore": TaskTypeInfo("Restore Track", "library"),
    "library_track_hard_delete": TaskTypeInfo("Delete Track", "library"),
    "library_quarantined_track_hard_delete": TaskTypeInfo(
        "Delete Quarantined Track", "library"
    ),
    "library_quarantined_tracks_hard_delete_all": TaskTypeInfo(
        "Empty Track Quarantine", "library"
    ),
    "library_track_move": TaskTypeInfo("Move Track", "library"),
    "library_album_move_to_artist": TaskTypeInfo("Move Album to Artist", "library"),
    "library_album_merge": TaskTypeInfo("Merge Albums", "library"),
    "library_album_split": TaskTypeInfo("Split Album", "library"),
    "library_artist_merge": TaskTypeInfo("Merge Artists", "library"),
    "move_artist": TaskTypeInfo("Move Artist", "library"),
    "wipe_library": TaskTypeInfo("Wipe Library", "library"),
    "rebuild_library": TaskTypeInfo("Rebuild Library", "library"),
    "match_apply": TaskTypeInfo("Apply Metadata Match", "library"),
    "update_artist_metadata": TaskTypeInfo("Update Artist Metadata", "library"),
    "update_album_tags": TaskTypeInfo("Update Album Tags", "library"),
    "update_track_tags": TaskTypeInfo("Update Track Tags", "library"),
    "write_portable_metadata": TaskTypeInfo("Portable Metadata", "library"),
    "rehydrate_portable_metadata": TaskTypeInfo(
        "Portable Metadata Rehydrate", "library"
    ),
    "export_rich_metadata": TaskTypeInfo("Rich Metadata Export", "library"),
    "migrate_storage_v2": TaskTypeInfo("Legacy Storage Migration v2", "library"),
    "fix_artist": TaskTypeInfo("Artist Fix", "library"),
    "verify_storage_v2": TaskTypeInfo("Verify Storage v2", "library"),
    "tidal_download": TaskTypeInfo("Tidal Download", "acquisition"),
    "soulseek_download": TaskTypeInfo("Soulseek Download", "acquisition"),
    "check_new_releases": TaskTypeInfo("Check New Releases", "acquisition"),
    "cleanup_incomplete_downloads": TaskTypeInfo(
        "Clean Incomplete Downloads", "acquisition"
    ),
    "library_upload": TaskTypeInfo("Library Upload", "acquisition"),
    "import_queue_item": TaskTypeInfo("Import Staged Album", "acquisition"),
    "import_queue_all": TaskTypeInfo("Import Staged Albums", "acquisition"),
    "import_queue_remove": TaskTypeInfo("Remove Staged Import", "acquisition"),
    "remux_m4a_dash": TaskTypeInfo("Remux DASH Audio", "acquisition"),
    "bandcamp_connect_credentials": TaskTypeInfo("Connect Bandcamp", "acquisition"),
    "bandcamp_sync_collection": TaskTypeInfo("Bandcamp Collection Sync", "acquisition"),
    "bandcamp_discover_refresh": TaskTypeInfo(
        "Bandcamp Discover Refresh", "acquisition"
    ),
    "bandcamp_import_purchase": TaskTypeInfo("Import Bandcamp Purchase", "acquisition"),
    "bandcamp_radar_refresh": TaskTypeInfo("Bandcamp Radar Refresh", "acquisition"),
    "bandcamp_backfill_entity_urls": TaskTypeInfo(
        "Bandcamp URL Backfill", "acquisition"
    ),
    "bandcamp_withdraw_contribution": TaskTypeInfo(
        "Withdraw Bandcamp Contribution", "acquisition"
    ),
    "bandcamp_cleanup_user_contributions": TaskTypeInfo(
        "Clean Bandcamp Contributions", "acquisition"
    ),
    "library_withdraw_contribution": TaskTypeInfo(
        "Withdraw Contribution", "acquisition"
    ),
    "library_cleanup_user_contributions": TaskTypeInfo(
        "Clean User Contributions", "acquisition"
    ),
    "federation_sync_catalog": TaskTypeInfo("Sync Federated Catalog", "federation"),
    "federation_health_poll": TaskTypeInfo("Federation Health Poll", "federation"),
    "federation_import_album": TaskTypeInfo("Import Federated Album", "federation"),
    "federation_directory_refresh": TaskTypeInfo(
        "Federation Directory Refresh", "federation"
    ),
    "global_catalog_reconcile_incremental": TaskTypeInfo(
        "Global Catalog Reconciliation", "federation"
    ),
    "global_catalog_reconcile_full": TaskTypeInfo(
        "Full Global Catalog Reconciliation", "federation"
    ),
    "enrich_artist": TaskTypeInfo("Artist Enrichment", "enrichment"),
    "enrich_artists": TaskTypeInfo("Artist Enrichment", "enrichment"),
    "sync_lyrics": TaskTypeInfo("Lyrics Sync", "enrichment"),
    "reset_enrichment": TaskTypeInfo("Reset Enrichment", "enrichment"),
    "enrich_mbids": TaskTypeInfo("MusicBrainz ID Enrichment", "enrichment"),
    "compute_completeness": TaskTypeInfo("Discography Completeness", "enrichment"),
    "refresh_probable_setlist": TaskTypeInfo("Probable Setlist Refresh", "enrichment"),
    "normalize_artist_bios": TaskTypeInfo("Normalize Artist Bios", "enrichment"),
    "research_artist_bio": TaskTypeInfo("Research Artist Bio", "enrichment"),
    "sync_shows": TaskTypeInfo("Shows Sync", "enrichment"),
    "backfill_similarities": TaskTypeInfo("Artist Similarity Backfill", "enrichment"),
    "index_genres": TaskTypeInfo("Genre Indexing", "enrichment"),
    "infer_genre_taxonomy": TaskTypeInfo("Taxonomy Inference", "enrichment"),
    "rebuild_genre_taxonomy_proposals": TaskTypeInfo(
        "Taxonomy Proposals Rebuild", "enrichment"
    ),
    "enrich_genre_descriptions": TaskTypeInfo(
        "Genre Description Enrichment", "enrichment"
    ),
    "sync_musicbrainz_genre_graph": TaskTypeInfo(
        "MusicBrainz Genre Graph Sync", "enrichment"
    ),
    "cleanup_invalid_genre_taxonomy": TaskTypeInfo("Taxonomy Cleanup", "enrichment"),
    "compute_analytics": TaskTypeInfo("Library Analytics", "analysis"),
    "refresh_user_listening_stats": TaskTypeInfo("Listening Stats Refresh", "analysis"),
    "refresh_home_discovery_snapshot": TaskTypeInfo(
        "Home Discovery Refresh", "analysis"
    ),
    "refresh_user_stats_dashboard_snapshot": TaskTypeInfo(
        "User Stats Refresh", "analysis"
    ),
    "refresh_instance_stats_dashboard_snapshot": TaskTypeInfo(
        "Instance Stats Refresh", "analysis"
    ),
    "compute_popularity": TaskTypeInfo("Popularity Update", "analysis"),
    "backfill_track_audio_fingerprints": TaskTypeInfo(
        "Track Fingerprint Backfill", "analysis"
    ),
    "analyze_tracks": TaskTypeInfo("Track Analysis", "analysis"),
    "analyze_all": TaskTypeInfo("Full Audio Analysis", "analysis"),
    "analyze_album_full": TaskTypeInfo("Album Analysis", "analysis"),
    "compute_bliss": TaskTypeInfo("Bliss Similarity", "analysis"),
    "materialize_artwork_variants": TaskTypeInfo("Artwork Variants", "artwork"),
    "backfill_artwork_variants": TaskTypeInfo("Artwork Variant Backfill", "artwork"),
    "cleanup_artwork_variants": TaskTypeInfo("Artwork Variant Cleanup", "artwork"),
    "repair_artwork_variants": TaskTypeInfo("Artwork Variant Repair", "artwork"),
    "resolve_external_artist_artwork": TaskTypeInfo(
        "External Artist Artwork", "artwork"
    ),
    "fetch_cover": TaskTypeInfo("Fetch Cover", "artwork"),
    "fetch_album_cover": TaskTypeInfo("Fetch Album Cover", "artwork"),
    "fetch_artist_covers": TaskTypeInfo("Fetch Artist Covers", "artwork"),
    "fetch_artwork_all": TaskTypeInfo("Fetch All Artwork", "artwork"),
    "batch_covers": TaskTypeInfo("Batch Covers", "artwork"),
    "scan_missing_covers": TaskTypeInfo("Missing Cover Scan", "artwork"),
    "apply_cover": TaskTypeInfo("Apply Cover", "artwork"),
    "upload_image": TaskTypeInfo("Image Upload", "artwork"),
    "compose_artist_hero": TaskTypeInfo("Artist Hero Composition", "artwork"),
    "preview_artist_hero": TaskTypeInfo("Artist Hero Preview", "artwork"),
    "recompose_artist_hero": TaskTypeInfo("Artist Hero Renderer Migration", "artwork"),
    "derive_artist_hero": TaskTypeInfo("Artist Hero Derivation", "artwork"),
    "backfill_artist_heroes": TaskTypeInfo("Artist Hero Backfill", "artwork"),
    "migrate_artist_heroes": TaskTypeInfo("Artist Hero Migration Canary", "artwork"),
    "migrate_artist_hero": TaskTypeInfo("Artist Hero Migration", "artwork"),
    "rollback_artist_hero": TaskTypeInfo("Artist Hero Rollback", "artwork"),
    "delete_artist_hero_composition": TaskTypeInfo("Delete Artist Hero", "artwork"),
    "import_artist_artwork_asset": TaskTypeInfo("Artist Artwork Gallery", "artwork"),
    "assign_artist_artwork_slot": TaskTypeInfo("Artist Artwork Assignment", "artwork"),
    "delete_artist_artwork_asset": TaskTypeInfo("Artist Artwork Deletion", "artwork"),
    "prepare_stream_variant": TaskTypeInfo("Prepare Playback Stream", "playback"),
    "warmup_stream_variants": TaskTypeInfo("Warm Playback Cache", "playback"),
    "cleanup_stream_variants": TaskTypeInfo("Clean Playback Cache", "playback"),
    "crate_download": TaskTypeInfo("Crate Download", "playback"),
    "generate_cast_spectrum": TaskTypeInfo("Cast Spectrum", "playback"),
    "prime_jam_auto_dj": TaskTypeInfo("Jam Room Auto DJ", "playback"),
    "generate_system_playlist": TaskTypeInfo("Playlist Generation", "playlists"),
    "refresh_system_smart_playlists": TaskTypeInfo(
        "Refresh Smart Playlists", "playlists"
    ),
    "persist_playlist_cover": TaskTypeInfo("Save Playlist Cover", "playlists"),
    "draft_i18n_translation": TaskTypeInfo("Listen Translation Draft", "playlists"),
}

TASK_TYPE_LABELS: dict[str, str] = {
    name: info.label for name, info in TASK_TYPES.items()
}

TASK_ACTIONS: tuple[TaskAction, ...] = (
    TaskAction(
        id="sync-library",
        label="Sync Library",
        task_type="library_sync",
        path="/api/tasks/sync-library",
        capability="library.import.manage",
        icon="refresh",
    ),
    TaskAction(
        id="sync-federated-catalogs",
        label="Sync Federated Catalogs",
        task_type="federation_sync_catalog",
        path="/api/admin/federation/sync-catalog",
        capability="federation.catalog.sync.manage",
        icon="refresh",
    ),
    TaskAction(
        id="reconcile-global-catalog",
        label="Reconcile Global Catalog",
        task_type="global_catalog_reconcile_incremental",
        path="/api/admin/global-catalog/reconcile",
        capability="federation.policy.manage",
        icon="refresh",
        body={"mode": "incremental"},
    ),
    TaskAction(
        id="reconcile-global-catalog-full",
        label="Full Global Catalog Reconciliation",
        task_type="global_catalog_reconcile_full",
        path="/api/admin/global-catalog/reconcile",
        capability="federation.policy.manage",
        icon="refresh",
        body={"mode": "full"},
    ),
    TaskAction(
        id="health-check",
        label="Run Health Check",
        task_type="health_check",
        path="/api/manage/health-check",
        capability="library.repair.run",
        icon="stethoscope",
    ),
    TaskAction(
        id="remove-duplicate-tracks",
        label="Remove Duplicate Tracks",
        task_type="repair_duplicate_tracks",
        path="/api/manage/repair-duplicate-tracks",
        capability="library.repair.run",
        icon="trash",
    ),
    TaskAction(
        id="analyze-all",
        label="Analyze All Tracks (BPM, Key, Energy)",
        task_type="analyze_all",
        path="/api/manage/analyze-all",
        capability="library.analysis.manage",
        icon="brain",
    ),
    TaskAction(
        id="compute-bliss",
        label="Compute Bliss Vectors",
        task_type="compute_bliss",
        path="/api/manage/compute-bliss",
        capability="library.analysis.manage",
        icon="radio",
    ),
    TaskAction(
        id="compute-popularity",
        label="Compute Popularity (Last.fm)",
        task_type="compute_popularity",
        path="/api/manage/compute-popularity",
        capability="library.analysis.manage",
        icon="chart",
    ),
    TaskAction(
        id="backfill-fingerprints",
        label="Backfill Audio Fingerprints (Chromaprint)",
        task_type="backfill_track_audio_fingerprints",
        path="/api/tasks/backfill-track-fingerprints",
        capability="library.analysis.manage",
        icon="brain",
    ),
    TaskAction(
        id="enrich-mbids",
        label="Enrich MusicBrainz IDs",
        task_type="enrich_mbids",
        path="/api/manage/enrich-mbids",
        capability="library.metadata.write",
        icon="sparkles",
    ),
    TaskAction(
        id="backfill-release-dates",
        label="Backfill Album Release Dates",
        task_type="enrich_mbids",
        path="/api/manage/enrich-mbids",
        capability="library.metadata.write",
        icon="calendar",
        body={"release_dates_only": True},
    ),
    TaskAction(
        id="sync-lyrics",
        label="Sync Missing Lyrics",
        task_type="sync_lyrics",
        path="/api/manage/sync-lyrics",
        capability="library.metadata.write",
        icon="file-json",
        body={"limit": 1000},
    ),
    TaskAction(
        id="write-portable-metadata",
        label="Write Portable Metadata",
        task_type="write_portable_metadata",
        path="/api/manage/portable-metadata",
        capability="library.metadata.write",
        icon="tags",
        body={"write_audio_tags": True, "write_sidecars": True},
    ),
    TaskAction(
        id="rehydrate-portable-metadata",
        label="Rehydrate From Portable Metadata",
        task_type="rehydrate_portable_metadata",
        path="/api/manage/portable-metadata/rehydrate",
        capability="library.metadata.write",
        icon="file-input",
    ),
    TaskAction(
        id="export-rich-metadata",
        label="Export Rich Metadata Index",
        task_type="export_rich_metadata",
        path="/api/manage/portable-metadata/export-rich",
        capability="library.metadata.write",
        icon="archive",
        body={"include_audio": False, "write_rich_tags": False},
    ),
    TaskAction(
        id="backfill-similarities",
        label="Backfill Artist Similarities",
        task_type="backfill_similarities",
        path="/api/tasks/backfill-similarities",
        capability="library.metadata.write",
        icon="sparkles",
    ),
    TaskAction(
        id="sync-shows",
        label="Sync Shows (Ticketmaster)",
        task_type="sync_shows",
        path="/api/tasks/sync-shows",
        capability="curation.shows.write",
        icon="sparkles",
    ),
    TaskAction(
        id="cleanup-genre-taxonomy",
        label="Clean Invalid Genre Taxonomy Nodes",
        task_type="cleanup_invalid_genre_taxonomy",
        path="/api/genres/taxonomy/cleanup-invalid",
        capability="curation.genres.write",
        icon="sparkles",
    ),
    TaskAction(
        id="check-new-releases",
        label="Check New Releases (MusicBrainz)",
        task_type="check_new_releases",
        path="/api/acquisition/new-releases/check",
        capability="curation.releases.write",
        icon="sparkles",
    ),
)

TASK_TYPE_ICONS: dict[str, str] = {
    "prime_jam_auto_dj": "🎵",
    "library_sync": "\U0001f4c2",
    "import_queue_item": "\U0001f4e5",
    "import_queue_all": "\U0001f4e5",
    "import_queue_remove": "\U0001f5d1",
    "federation_import_album": "\U0001f4e5",
    "federation_sync_catalog": "\U0001f504",
    "global_catalog_reconcile_incremental": "\U0001f504",
    "global_catalog_reconcile_full": "\U0001f504",
    "scan": "\U0001f50d",
    "process_new_content": "\u2728",
    "delete_artist": "\U0001f5d1",
    "delete_album": "\U0001f5d1",
    "migrate_storage_v2": "\U0001f4e6",
    "fix_artist": "\U0001f527",
    "write_portable_metadata": "\U0001f4be",
    "rehydrate_portable_metadata": "\U0001f4e5",
    "export_rich_metadata": "\U0001f4e6",
    "enrich_artists": "\U0001f50e",
    "enrich_artist": "\U0001f50e",
    "sync_lyrics": "\U0001f4dd",
    "backfill_track_audio_fingerprints": "\U0001f9ec",
    "tidal_download": "\U0001f4e5",
    "soulseek_download": "\U0001f4e5",
    "bandcamp_backfill_entity_urls": "\U0001f517",
    "index_genres": "\U0001f3f7\ufe0f",
    "infer_genre_taxonomy": "\U0001f3f7\ufe0f",
    "enrich_genre_descriptions": "\U0001f4dd",
    "cleanup_invalid_genre_taxonomy": "\U0001f9f9",
    "prepare_stream_variant": "\U0001f3a7",
    "cleanup_stream_variants": "\U0001f9f9",
}


def task_label(task_type: str) -> str:
    """Human-readable label for a task type."""
    info = TASK_TYPES.get(task_type)
    return info.label if info else task_type.replace("_", " ").title()


def task_category(task_type: str) -> str:
    info = TASK_TYPES.get(task_type)
    return info.category if info else "other"


def task_icon(task_type: str) -> str:
    """Emoji icon for a task type (Telegram only)."""
    return TASK_TYPE_ICONS.get(task_type, "\u2699\ufe0f")
