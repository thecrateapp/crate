from crate.actors import TASK_POOL_CONFIG
from crate.worker import _configured_worker_slots


def test_interactive_artwork_tasks_stay_on_fast_queue():
    for task_type in (
        "fetch_cover",
        "apply_cover",
        "fetch_album_cover",
        "upload_image",
        "persist_playlist_cover",
    ):
        assert TASK_POOL_CONFIG[task_type].queue == "fast"


def test_long_running_background_tasks_do_not_use_fast_queue():
    for task_type in (
        "check_new_releases",
        "compute_analytics",
        "sync_lyrics",
        "fetch_artwork_all",
        "scan_missing_covers",
        "batch_covers",
        "enrich_artists",
        "compute_popularity",
        "bandcamp_radar_refresh",
    ):
        assert TASK_POOL_CONFIG[task_type].queue != "fast"


def test_worker_slot_count_reflects_split_worker_processes(monkeypatch):
    monkeypatch.setenv("FAST_WORKER_PROCESSES", "2")
    monkeypatch.setenv("MAINTENANCE_WORKER_PROCESSES", "1")
    monkeypatch.setenv("ANALYSIS_WORKER_PROCESSES", "1")
    monkeypatch.setenv("PLAYBACK_WORKER_PROCESSES", "1")

    assert _configured_worker_slots({"worker_processes": 3}) == 8
