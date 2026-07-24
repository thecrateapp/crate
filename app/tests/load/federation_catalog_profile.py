#!/usr/bin/env python3
"""Representative 900/4.4K/48K federation catalog capacity profile.

Run only against the isolated ``crate_test`` database. Fixtures are inserted
with a unique prefix and removed in ``finally``.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import statistics
import time
import tracemalloc
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import text

from crate.db.init_db import init_db
from crate.db.jobs.federation_catalog_changes import list_catalog_changes
from crate.db.queries.federation_manifest import (
    _entity_page_sql,
    list_federation_manifest_rows,
)
from crate.db.tx import read_scope, transaction_scope


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artists", type=int, default=900)
    parser.add_argument("--albums", type=int, default=4_400)
    parser.add_argument("--tracks", type=int, default=48_000)
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--enforce-slo", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]


def _rss_bytes() -> int:
    value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value if os.uname().sysname == "Darwin" else value * 1_024


def _policy() -> dict[str, Any]:
    return {
        "share_allowed": True,
        "allowed_entity_uids": [],
        "allowed_artist_uids": [],
        "allowed_album_uids": [],
        "allowed_track_uids": [],
        "denied_entity_uids": [],
    }


def _seed(run_id: str, artists: int, albums: int, tracks: int) -> None:
    prefix = f"Federation Profile {run_id}"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (
                    name, entity_uid, slug, album_count, track_count, updated_at
                )
                SELECT
                    :prefix || ' Artist ' || n,
                    md5(:run_id || ':artist:' || n::text)::uuid,
                    'federation-profile-' || :run_id || '-artist-' || n,
                    0, 0, NOW()
                FROM generate_series(1, :artists) AS n
                """
            ),
            {"prefix": prefix, "run_id": run_id, "artists": artists},
        )
        session.execute(
            text(
                """
                INSERT INTO library_albums (
                    artist, name, path, entity_uid, slug, track_count,
                    total_size, total_duration, updated_at
                )
                SELECT
                    :prefix || ' Artist ' || (((n - 1) % :artists) + 1),
                    'Album ' || n,
                    '/capacity/' || :run_id || '/album-' || n,
                    md5(:run_id || ':album:' || n::text)::uuid,
                    'album-' || n,
                    0, 0, 0, NOW()
                FROM generate_series(1, :albums) AS n
                """
            ),
            {
                "prefix": prefix,
                "run_id": run_id,
                "artists": artists,
                "albums": albums,
            },
        )
        session.execute(
            text(
                """
                WITH profile_albums AS (
                    SELECT id, artist, name,
                           row_number() OVER (ORDER BY id) AS ordinal
                    FROM library_albums
                    WHERE path LIKE '/capacity/' || :run_id || '/%'
                )
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path, entity_uid,
                    track_number, disc_number, format, bitrate, sample_rate,
                    bit_depth, duration, size, genre, updated_at
                )
                SELECT
                    album.id,
                    album.artist,
                    album.name,
                    'track-' || n || '.flac',
                    'Track ' || n,
                    '/capacity/' || :run_id || '/track-' || n || '.flac',
                    md5(:run_id || ':track:' || n::text)::uuid,
                    ((n - 1) % 12) + 1,
                    1,
                    'flac', 900000, 44100, 16, 180, 30000000, 'rock', NOW()
                FROM generate_series(1, :tracks) AS n
                JOIN profile_albums album
                  ON album.ordinal = (((n - 1) % :albums) + 1)
                """
            ),
            {"run_id": run_id, "albums": albums, "tracks": tracks},
        )


def _cleanup(run_id: str) -> None:
    prefix = f"Federation Profile {run_id}%"
    path_prefix = f"/capacity/{run_id}/%"
    with transaction_scope() as session:
        session.execute(
            text(
                "DELETE FROM federation_catalog_changes "
                "WHERE payload_json->>'profile_run' = :run_id"
            ),
            {"run_id": run_id},
        )
        session.execute(
            text("DELETE FROM library_tracks WHERE path LIKE :path_prefix"),
            {"path_prefix": path_prefix},
        )
        session.execute(
            text("DELETE FROM library_albums WHERE path LIKE :path_prefix"),
            {"path_prefix": path_prefix},
        )
        session.execute(
            text("DELETE FROM library_artists WHERE name LIKE :prefix"),
            {"prefix": prefix},
        )


def _profile_snapshot(page_size: int) -> dict[str, Any]:
    cursor_type = ""
    cursor_uid = ""
    latencies: list[float] = []
    page_bytes: list[int] = []
    count = 0
    tracemalloc.start()
    rss_before = _rss_bytes()
    started = time.perf_counter()
    while True:
        page_started = time.perf_counter()
        rows = list_federation_manifest_rows(
            after_entity_type=cursor_type,
            after_entity_uid=cursor_uid,
            limit=page_size,
            policy_params=_policy(),
        )
        latencies.append((time.perf_counter() - page_started) * 1_000)
        if not rows:
            break
        page_bytes.append(
            len(json.dumps(rows, separators=(",", ":"), default=str).encode())
        )
        count += len(rows)
        cursor_type = str(rows[-1]["entity_type"])
        cursor_uid = str(rows[-1]["remote_entity_uid"])
        if len(rows) < page_size:
            break
    elapsed = time.perf_counter() - started
    _, peak_allocated = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "items": count,
        "pages": len(page_bytes),
        "seconds": elapsed,
        "page_p50_ms": statistics.median(latencies),
        "page_p95_ms": _p95(latencies),
        "max_page_bytes": max(page_bytes, default=0),
        "python_peak_allocated_bytes": peak_allocated,
        "rss_growth_bytes": max(0, _rss_bytes() - rss_before),
    }


def _profile_delta(run_id: str, track_count: int, page_size: int) -> dict[str, Any]:
    changed = max(1, track_count // 100)
    with transaction_scope() as session:
        before = int(
            session.execute(
                text(
                    "SELECT COALESCE(MAX(sequence), 0) FROM federation_catalog_changes"
                )
            ).scalar_one()
        )
        session.execute(
            text(
                """
                INSERT INTO federation_catalog_changes (
                    entity_type, entity_uid, operation, payload_revision,
                    payload_json, retention_until
                )
                SELECT
                    'track', entity_uid::text, 'upsert',
                    'profile:' || :run_id || ':' || id,
                    jsonb_build_object(
                        'entity_type', 'track',
                        'remote_entity_uid', entity_uid::text,
                        'title', title,
                        'profile_run', :run_id
                    ),
                    NOW() + INTERVAL '90 days'
                FROM library_tracks
                WHERE path LIKE '/capacity/' || :run_id || '/%'
                ORDER BY id
                LIMIT :changed
                """
            ),
            {"run_id": run_id, "changed": changed},
        )
    latencies: list[float] = []
    cursor = before
    received = 0
    started = time.perf_counter()
    while received < changed:
        page_started = time.perf_counter()
        rows = list_catalog_changes(after_sequence=cursor, limit=page_size)
        latencies.append((time.perf_counter() - page_started) * 1_000)
        if not rows:
            break
        received += len(rows)
        cursor = int(rows[-1]["sequence"])
    delta_seconds = time.perf_counter() - started
    idle_latencies = []
    for _ in range(10):
        idle_started = time.perf_counter()
        list_catalog_changes(after_sequence=cursor, limit=page_size)
        idle_latencies.append((time.perf_counter() - idle_started) * 1_000)
    return {
        "changed_items": changed,
        "received_items": received,
        "seconds": delta_seconds,
        "page_p95_ms": _p95(latencies),
        "idle_p95_ms": _p95(idle_latencies),
    }


def _track_plan(page_size: int) -> dict[str, Any]:
    with read_scope() as session:
        plan = session.execute(
            text(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + _entity_page_sql("track")
            ),
            {
                "after_entity_uid": "",
                "limit": page_size,
                **_policy(),
            },
        ).scalar_one()[0]
    encoded = json.dumps(plan)
    return {
        "planning_ms": float(plan.get("Planning Time") or 0),
        "execution_ms": float(plan.get("Execution Time") or 0),
        "uses_entity_uid_index": "idx_lib_tracks_entity_uid" in encoded,
        "has_track_seq_scan": '"Node Type": "Seq Scan"' in encoded
        and '"Relation Name": "library_tracks"' in encoded,
    }


def _evaluate(snapshot: dict, delta: dict, plan: dict) -> list[str]:
    failures = []
    if snapshot["page_p95_ms"] >= 500:
        failures.append("snapshot page p95 >= 500 ms")
    if delta["idle_p95_ms"] >= 150:
        failures.append("idle delta p95 >= 150 ms")
    if delta["seconds"] >= snapshot["seconds"] * 0.1:
        failures.append("1% delta is not under 10% of full snapshot time")
    if snapshot["rss_growth_bytes"] >= 64 * 1024 * 1024:
        failures.append("worker RSS grew by 64 MiB or more")
    if plan["has_track_seq_scan"] or not plan["uses_entity_uid_index"]:
        failures.append("track page does not use the entity_uid index")
    return failures


def main() -> int:
    args = _arguments()
    database = os.environ.get("CRATE_POSTGRES_DB", "")
    if database != "crate_test":
        raise SystemExit(
            "capacity profile refuses to run outside CRATE_POSTGRES_DB=crate_test"
        )
    init_db()
    run_id = uuid.uuid4().hex[:10]
    try:
        _seed(run_id, args.artists, args.albums, args.tracks)
        snapshot = _profile_snapshot(args.page_size)
        delta = _profile_delta(run_id, args.tracks, args.page_size)
        plan = _track_plan(args.page_size)
        failures = _evaluate(snapshot, delta, plan)
        result = {
            "fixture": {
                "artists": args.artists,
                "albums": args.albums,
                "tracks": args.tracks,
            },
            "snapshot": snapshot,
            "delta_1_percent": delta,
            "track_page_plan": plan,
            "slo_failures": failures,
        }
        rendered = json.dumps(result, indent=2, sort_keys=True)
        print(rendered)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n")
        return 1 if args.enforce_slo and failures else 0
    finally:
        _cleanup(run_id)


if __name__ == "__main__":
    raise SystemExit(main())
