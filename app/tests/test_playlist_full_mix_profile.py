"""Full Smart Mix is an eligibility requirement, separate from musical OR rules."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate.db.repositories.playlists_rule_engine_executor import execute_smart_rules
from crate.db.tx import transaction_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


def _track(
    pg_db, index: int, *, genre: str = "Noise", quality: str | None = "full", **profile
):
    artist = f"Mix Artist {index}"
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {"artist": artist, "name": "Mix Album", "path": f"/music/mix-{index}"}
    )
    path = f"/music/mix-{index}/{index}.flac"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": "Mix Album",
            "filename": f"{index}.flac",
            "title": f"Mix Track {index}",
            "path": path,
            "duration": 180,
            "format": "flac",
            "genre": genre,
        }
    )
    track = pg_db.get_library_track_by_path(path)
    if quality is not None:
        with transaction_scope() as session:
            session.execute(
                text("""
                INSERT INTO track_mix_profiles
                    (track_id, profile_version, profile_revision, analyzer, analyzer_version,
                     source_revision, quality, source_stale_at, analyzed_at)
                VALUES (:track_id, :profile_version, :revision, 'crate-rust', :analyzer_version,
                        'source-v1', :quality, :source_stale_at, NOW())
            """),
                {
                    "track_id": track["id"],
                    "profile_version": PROFILE_SCHEMA_VERSION,
                    "revision": str(uuid4()),
                    "analyzer_version": ANALYZER_VERSION,
                    "quality": quality,
                    "source_stale_at": None,
                    **profile,
                },
            )
    return track


@pytest.mark.parametrize("single_genre", [False, True])
def test_full_mix_selection_and_count_require_current_full_profiles(
    pg_db, single_genre
):
    current = _track(pg_db, 1)
    _track(pg_db, 2, quality="partial")
    _track(pg_db, 3, quality="legacy")
    _track(pg_db, 4, quality="unavailable")
    _track(pg_db, 5, quality=None)
    _track(pg_db, 6, analyzer_version="old-analysis")
    _track(pg_db, 7, profile_version=PROFILE_SCHEMA_VERSION + 1)
    _track(pg_db, 8, source_stale_at=datetime.now(UTC))
    rules = {
        "rules": [{"field": "genre", "op": "contains", "value": "Noise"}]
        if single_genre
        else [],
        "limit": 20,
        "sort": "title",
        "require_full_mix_profile": True,
        "expand_related_genres": False,
        "deduplicate_artist": False,
    }
    assert execute_smart_rules(rules, count_only=True) == 1
    assert [row["id"] for row in execute_smart_rules(rules)] == [current["id"]]
    # Explicit false and legacy absence both keep the previous selection behavior.
    assert (
        execute_smart_rules(
            {**rules, "require_full_mix_profile": False}, count_only=True
        )
        == 8
    )
    del rules["require_full_mix_profile"]
    assert execute_smart_rules(rules, count_only=True) == 8


def test_full_mix_requirement_cannot_be_bypassed_by_match_any(pg_db):
    current = _track(pg_db, 1)
    _track(pg_db, 2, quality="partial")
    rules = {
        "match": "any",
        "rules": [
            {"field": "artist", "op": "eq", "value": "Mix Artist 2"},
            {"field": "title", "op": "contains", "value": "Mix"},
        ],
        "require_full_mix_profile": True,
        "sort": "title",
        "limit": 10,
    }
    assert execute_smart_rules(rules, count_only=True) == 1
    assert [row["id"] for row in execute_smart_rules(rules)] == [current["id"]]


@pytest.mark.parametrize("single_genre", [False, True])
def test_related_genre_expansion_keeps_full_profile_requirement(
    pg_db, monkeypatch, single_genre
):
    _track(pg_db, 1, genre="Noise")
    related = _track(pg_db, 2, genre="Drone")
    _track(pg_db, 3, genre="Drone", quality="partial")
    monkeypatch.setattr(
        "crate.db.repositories.playlists_rule_engine_executor.get_related_genre_terms",
        lambda *_args, **_kwargs: ["Drone"],
    )
    selection = [{"field": "genre", "op": "contains", "value": "Noise"}]
    if not single_genre:
        selection.append({"field": "duration", "op": "gte", "value": 100})
    rules = {
        "rules": selection,
        "require_full_mix_profile": True,
        "sort": "title",
        "limit": 10,
        "deduplicate_artist": True,
        "expand_related_genres": True,
    }
    tracks = execute_smart_rules(rules)
    assert [row["artist"] for row in tracks] == ["Mix Artist 1", "Mix Artist 2"]
    assert related["id"] in {row["id"] for row in tracks}


def test_admin_preview_and_generation_share_full_profile_selection(pg_db, monkeypatch):
    from fastapi import Request

    from crate.api import system_playlists as api
    from crate.api.schemas.curation import PreviewSystemPlaylistRequest
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.worker_handlers import management

    current = _track(pg_db, 1)
    _track(pg_db, 2, quality="partial")
    rules = {
        "rules": [],
        "limit": 10,
        "sort": "title",
        "require_full_mix_profile": True,
    }
    playlist_id = create_playlist(
        "Mix ready",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules=rules,
    )
    monkeypatch.setattr(api, "_require_playlist_curator", lambda _: {"id": 1})
    request = Request({"type": "http", "method": "POST", "path": "/"})
    preview = api.admin_preview_system_playlist(
        request, playlist_id, PreviewSystemPlaylistRequest(smart_rules=rules)
    )
    assert preview["total_matching"] == 1
    assert [track["title"] for track in preview["tracks"]] == ["Mix Track 1"]

    monkeypatch.setattr(management, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(management, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("crate.telegram.send_message", lambda *_args, **_kwargs: None)
    result = management._handle_generate_system_playlist(
        "test-full-mix", {"playlist_id": playlist_id}, {}
    )
    assert result["track_count"] == 1
    assert [track["track_id"] for track in get_playlist_tracks(playlist_id)] == [
        current["id"]
    ]


def test_full_mix_requirement_preserves_explicit_manual_and_locked_overrides(pg_db):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
    )

    current = _track(pg_db, 1)
    manual = _track(pg_db, 2, quality="partial")
    locked = _track(pg_db, 3, quality=None)
    rules = {"rules": [], "limit": 3, "require_full_mix_profile": True}
    playlist_id = create_playlist(
        "Curator overrides",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules=rules,
    )
    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": manual["id"], "source": "manual"},
            {"track_id": locked["id"], "source": "generated", "locked": True},
        ],
    )
    candidates = execute_smart_rules(rules)
    assert [row["id"] for row in candidates] == [current["id"]]
    regenerate_playlist_tracks(playlist_id, candidates, target_count=3)
    tracks = get_playlist_tracks(playlist_id)
    assert [row["track_id"] for row in tracks] == [
        manual["id"],
        locked["id"],
        current["id"],
    ]
    assert tracks[0]["source"] == "manual"
    assert tracks[1]["locked"] is True
