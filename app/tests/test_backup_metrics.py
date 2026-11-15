"""Backup gauges: bounded labels, exported names, values from the backup tables (BK6)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crate.backups import metrics
from crate.backups.providers import PROVIDERS
from crate.observability.metric_catalog import canonical_metric
from crate.observability.metric_catalog_data import LABEL_VALUES
from crate.observability.prometheus import EXPORTED_FAMILIES

T0 = datetime(2026, 11, 13, 3, 0, tzinfo=timezone.utc)


def _run(minutes_after: int, took: int, **extra):
    started = T0 + timedelta(minutes=minutes_after)
    return {
        "started_at": started,
        "finished_at": started + timedelta(seconds=took),
        **extra,
    }


def test_the_gauges_are_exported_under_their_prometheus_names():
    names = {
        source: family.name
        for source, family in EXPORTED_FAMILIES.items()
        if source.startswith("backup.")
    }
    assert names == {
        "backup.bytes": "crate_backup_bytes",
        "backup.last_success.timestamp": "crate_backup_last_success_timestamp_seconds",
        "backup.run.duration": "crate_backup_run_duration_seconds",
    }
    assert all(EXPORTED_FAMILIES[s].kind == "gauge" for s in names)
    assert EXPORTED_FAMILIES["backup.bytes"].labels == ("destination",)
    assert EXPORTED_FAMILIES["backup.run.duration"].labels == ("destination", "kind")


def test_labels_are_the_provider_kinds_never_names():
    assert set(LABEL_VALUES["backup_destination"]) == {"dumps", *PROVIDERS}
    assert set(LABEL_VALUES["backup_run_kind"]) == {
        "dump",
        "local_retention",
        *metrics.DESTINATION_RUN_KINDS,
    }
    named = canonical_metric("backup.bytes", {"destination": "Cloudflare R2 (Diego)"})
    assert named.tags == (("destination", "other"),)


def test_samples_report_the_destination_that_is_behind():
    destinations = [
        {"id": "r2", "kind": "s3", "enabled": True, "repository_bytes": 1000},
        {"id": "wasabi", "kind": "s3", "enabled": True, "repository_bytes": 500},
        {"id": "drive", "kind": "gdrive", "enabled": True, "repository_bytes": None},
        {"id": "old", "kind": "b2", "enabled": False, "repository_bytes": 9},
    ]
    latest = {
        "r2": {"offsite_succeeded": _run(60, 30), "verify_succeeded": _run(70, 600)},
        "wasabi": {"offsite_succeeded": _run(0, 90)},
        "drive": {"offsite": _run(10, 5, status="failed")},
        "old": {"offsite_succeeded": _run(0, 1)},
    }
    local_runs = {
        "dump_succeeded": _run(0, 120, bytes=4_200_000),
        "local_retention": _run(5, 2, status="failed"),
    }

    samples = metrics.backup_samples(
        destinations=destinations, latest=latest, local_runs=local_runs
    )
    by_key = {
        (name, tuple(sorted(tags.items()))): value for name, value, tags in samples
    }

    def value(name, **tags):
        return by_key[(name, tuple(sorted(tags.items())))]

    oldest_copy = (T0 + timedelta(seconds=90)).timestamp()
    assert value("backup.last_success.timestamp", destination="s3", kind="offsite") == (
        oldest_copy
    )
    assert value("backup.run.duration", destination="s3", kind="offsite") == 90
    assert value("backup.run.duration", destination="s3", kind="verify") == 600
    assert value("backup.bytes", destination="s3") == 1500
    assert value("backup.last_success.timestamp", destination="dumps", kind="dump") == (
        (T0 + timedelta(seconds=120)).timestamp()
    )
    assert value("backup.bytes", destination="dumps") == 4_200_000
    # Never succeeded, disabled or unknown: no sample, never a zero.
    assert not any(
        tags.get("destination") in ("gdrive", "b2") for _, _, tags in samples
    )
    assert not any(tags.get("kind") == "local_retention" for _, _, tags in samples)
    for name, _value, tags in samples:
        assert canonical_metric(name, tags).normalized_labels == 0


def test_recording_goes_through_the_catalogue(monkeypatch):
    recorded = []
    monkeypatch.setattr(
        "crate.metrics.record", lambda name, value, tags=None: recorded.append(name)
    )
    samples = metrics.record_backup_metrics(
        {
            "destinations": [],
            "latest": {},
            "local_runs": {"dump_succeeded": _run(0, 60, bytes=10)},
        }
    )
    assert (
        recorded
        == [name for name, _, _ in samples]
        == [
            "backup.last_success.timestamp",
            "backup.run.duration",
            "backup.bytes",
        ]
    )


def test_latest_local_runs_reads_the_latest_and_the_latest_good_run(pg_db):
    del pg_db
    from crate.db.queries.backup_runs import latest_local_runs
    from crate.db.repositories.backup_runs import finish_backup_run, start_backup_run

    good = start_backup_run("dump", task_id="t1")
    finish_backup_run(good, status="succeeded", size_bytes=42)
    bad = start_backup_run("dump", task_id="t2")
    finish_backup_run(bad, status="failed", error="pg_dump failed")

    runs = latest_local_runs()
    assert runs["dump"]["id"] == bad and runs["dump"]["status"] == "failed"
    assert runs["dump_succeeded"]["id"] == good
    assert runs["dump_succeeded"]["bytes"] == 42
    assert "local_retention" not in runs
