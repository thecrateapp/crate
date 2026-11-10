"""Isolated receiver bootstrap profile, including canonical/search visibility.

The large profile is opt-in; pg_db always supplies a disposable PostgreSQL clone.
CRATE_FEDERATION_BOOTSTRAP_CAPACITY=1 enables the 1050/11000/140000 workload.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from collections import Counter
from itertools import islice
from pathlib import Path

import pytest
from sqlalchemy import event, text

from tests.conftest import approve_federation_node


def _manifest_items(prefix, artists, albums, tracks):
    for i in range(artists):
        yield {
            "entity_type": "artist",
            "entity_uid": f"artist-{i}",
            "title": f"{prefix} Artist {i}",
            "genres": ["rock"],
            "facets": {"artist_overview": {"available": True}},
        }
    for i in range(albums):
        yield {
            "entity_type": "album",
            "entity_uid": f"album-{i}",
            "title": f"{prefix} Album {i}",
            "artist": f"{prefix} Artist {i % artists}",
            "year": 1980 + (i % 45),
            "genres": ["rock"],
            "facets": {"album_overview": {"available": True}},
        }
    for i in range(tracks):
        album = i % albums
        yield {
            "entity_type": "track",
            "entity_uid": f"track-{i}",
            "title": f"{prefix} Track {i}",
            "artist": f"{prefix} Artist {album % artists}",
            "album": f"{prefix} Album {album}",
            "duration_seconds": 180 + (i % 120),
            "track_number": (i % 12) + 1,
            "disc_number": 1,
            "genres": ["rock"],
            "audio_features": {"bpm": 90 + i % 80, "energy": 0.6},
            "quality": {"format": "flac", "bitrate": 900000, "sample_rate": 44100},
            "facets": {"track_audio_features": {"available": True}},
        }


def _profile_bootstrap(*, artists, albums, tracks, node_uid, deadline=600):
    from crate.db.engine import get_engine
    from crate.db.jobs.global_catalog_reconciliation import (
        reconcile_dirty_catalog_sources,
    )
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        search_global_catalog,
    )
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope

    engine = get_engine()
    counters = {"queries": 0, "commits": 0}
    sql_seconds = Counter()

    def before(_conn, _cursor, _statement, _params, context, _many):
        context._bootstrap_started = time.perf_counter()
        counters["queries"] += 1

    def after(_conn, _cursor, statement, _params, context, _many):
        key = " ".join(statement.split())[:180]
        sql_seconds[key] += time.perf_counter() - context._bootstrap_started

    def committed(_conn):
        counters["commits"] += 1

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    event.listen(engine, "commit", committed)
    report = {"fixture": {"artists": artists, "albums": albums, "tracks": tracks}}
    started = time.perf_counter()
    try:
        prefix = f"Capacity {uuid.uuid4().hex[:8]}"
        source = iter(_manifest_items(prefix, artists, albums, tracks))
        sync_uid = str(uuid.uuid4())
        applied = 0
        pages = 0
        while page := list(islice(source, 500)):
            pages += 1
            result = apply_federation_manifest_page(
                node_uid=node_uid,
                items=page,
                revision="capacity-revision",
                sync_session_uid=sync_uid,
                checkpoint={
                    "next_page": pages,
                    "page_size": 500,
                    "synced": applied + len(page),
                },
            )
            applied += result["applied"]
        report["import_seconds"] = time.perf_counter() - started
        report["manifest_pages"] = pages
        report["import_queries"] = counters["queries"]
        report["import_commits"] = counters["commits"]
        projected = 0
        passes = 0
        while True:
            result = reconcile_dirty_catalog_sources(limit=1000)
            passes += 1
            projected += result["completed"]
            assert result["failed"] == 0, result
            assert time.perf_counter() - started < deadline, report
            if result["remaining"] == 0:
                break
            assert result["claimed"] > 0, result
        report["projection_seconds"] = (
            time.perf_counter() - started - report["import_seconds"]
        )
        report["projection_passes"] = passes
        report["projected"] = projected
        report["canonical_counts"] = get_global_catalog_counts()
        with read_scope() as session:
            assert (
                session.execute(text("SELECT current_database()"))
                .scalar_one()
                .startswith("crate_test_")
            )
            report["search_documents"] = session.execute(
                text("SELECT COUNT(*) FROM global_catalog_search_documents")
            ).scalar_one()
        last_track = search_global_catalog(f"{prefix} Track {tracks - 1}", limit=50)
        assert any(
            t["title"] == f"{prefix} Track {tracks - 1}" for t in last_track["tracks"]
        )
        report["search_visible"] = True
        report["total_seconds"] = time.perf_counter() - started
        report.update(counters)
        report["top_sql_seconds"] = sql_seconds.most_common(10)
        return report
    finally:
        event.remove(engine, "before_cursor_execute", before)
        event.remove(engine, "after_cursor_execute", after)
        event.remove(engine, "commit", committed)
        output = os.environ.get("CRATE_FEDERATION_BOOTSTRAP_REPORT")
        if output:
            Path(output).write_text(json.dumps(report, indent=2, default=str) + "\n")


@pytest.fixture
def bootstrap_peer(pg_db, monkeypatch):
    del pg_db
    from crate.db.repositories import tasks_mutations, tasks_shared
    from crate.db.tx import transaction_scope

    monkeypatch.setattr(tasks_mutations, "dispatch_task", lambda *_: None)
    monkeypatch.setattr(tasks_shared, "publish_tasks_surface_signal", lambda: None)
    monkeypatch.setattr(tasks_shared, "_publish_task_transition_signal", lambda _: None)
    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    return node_uid


def test_receiver_bootstrap_makes_all_manifest_entities_searchable(
    bootstrap_peer, request
):
    result = _profile_bootstrap(
        artists=5, albums=10, tracks=40, node_uid=bootstrap_peer
    )
    assert result["canonical_counts"] == {
        "artists": 5,
        "albums": 10,
        "tracks": 40,
        "sources": 55,
    }
    assert result["search_documents"] == 55
    request.node.user_properties.append(("receiver_bootstrap", result))


@pytest.mark.skipif(
    os.environ.get("CRATE_FEDERATION_BOOTSTRAP_CAPACITY") != "1",
    reason="opt-in isolated 140k-track capacity profile",
)
def test_receiver_bootstrap_capacity_with_canonical_and_search_visibility(
    bootstrap_peer, request
):
    artists = int(os.environ.get("CRATE_FEDERATION_BOOTSTRAP_ARTISTS", "1050"))
    albums = int(os.environ.get("CRATE_FEDERATION_BOOTSTRAP_ALBUMS", "11000"))
    tracks = int(os.environ.get("CRATE_FEDERATION_BOOTSTRAP_TRACKS", "140000"))
    result = _profile_bootstrap(
        artists=artists, albums=albums, tracks=tracks, node_uid=bootstrap_peer
    )
    assert result["canonical_counts"] == {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "sources": artists + albums + tracks,
    }
    assert result["search_documents"] == artists + albums + tracks
    assert result["total_seconds"] < 600
    request.node.user_properties.append(("receiver_bootstrap_capacity", result))
