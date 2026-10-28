from datetime import datetime, timezone
from unittest.mock import patch

import pytest
import requests
from pydantic import ValidationError
from sqlalchemy import text

from crate.db.queries.lyrics import list_tracks_for_lyrics
from crate.db.repositories.lyrics import get_cached_lyrics, merge_lyrics, store_lyrics
from crate.db.tx import transaction_scope
from crate.lyrics import get_or_fetch_lyrics, sync_lyrics_for_tracks


class _Response:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def _age_lyrics(artist: str, title: str, days: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE track_lyrics
                SET updated_at = NOW() - make_interval(days => :days)
                WHERE artist_key = lower(:artist) AND title_key = lower(:title)
                """
            ),
            {"artist": artist, "title": title, "days": days},
        )


def test_not_found_refresh_keeps_existing_lyrics(pg_db):
    store_lyrics("Touche Amore", "Flowers", plain_lyrics="Kept words")

    with patch("crate.lyrics.requests.get", return_value=_Response(404)):
        result = get_or_fetch_lyrics("Touche Amore", "Flowers", force=True)

    assert result == {"syncedLyrics": None, "plainLyrics": "Kept words"}
    cached = get_cached_lyrics("Touche Amore", "Flowers")
    assert cached["plainLyrics"] == "Kept words"
    assert cached["found"] is True


def test_plain_candidate_does_not_replace_synced_lyrics(pg_db):
    store_lyrics(
        "Touche Amore",
        "Lament",
        synced_lyrics="[00:01.00]Timed",
        plain_lyrics="Timed",
    )

    with patch(
        "crate.lyrics.requests.get",
        return_value=_Response(200, {"syncedLyrics": None, "plainLyrics": "Other"}),
    ):
        result = get_or_fetch_lyrics("Touche Amore", "Lament", force=True)

    assert result == {"syncedLyrics": "[00:01.00]Timed", "plainLyrics": "Timed"}


def test_synced_candidate_promotes_plain_lyrics(pg_db):
    store_lyrics("Touche Amore", "Nobody's", plain_lyrics="Old plain")

    with patch(
        "crate.lyrics.requests.get",
        return_value=_Response(
            200, {"syncedLyrics": "[00:01.00]New", "plainLyrics": "New"}
        ),
    ):
        result = get_or_fetch_lyrics("Touche Amore", "Nobody's", force=True)

    assert result == {"syncedLyrics": "[00:01.00]New", "plainLyrics": "New"}


@pytest.mark.parametrize("failure", [requests.Timeout("timed out"), None])
def test_stale_entry_survives_provider_failures(pg_db, failure):
    store_lyrics("Defeater", "Dear Father", synced_lyrics="[00:01.00]Stored")
    _age_lyrics("Defeater", "Dear Father", days=40)

    if failure is None:
        fetch = patch("crate.lyrics.requests.get", return_value=_Response(503))
    else:
        fetch = patch("crate.lyrics.requests.get", side_effect=failure)
    with fetch as live_fetch:
        result = get_or_fetch_lyrics("Defeater", "Dear Father")

    live_fetch.assert_called_once()
    assert result == {"syncedLyrics": "[00:01.00]Stored", "plainLyrics": None}
    cached = get_cached_lyrics("Defeater", "Dear Father", max_age_seconds=None)
    assert cached["syncedLyrics"] == "[00:01.00]Stored"


def test_provider_failure_without_cache_returns_empty(pg_db):
    with patch("crate.lyrics.requests.get", side_effect=requests.Timeout("down")):
        result = get_or_fetch_lyrics("Defeater", "Unknown")

    assert result == {"syncedLyrics": None, "plainLyrics": None}
    assert get_cached_lyrics("Defeater", "Unknown", max_age_seconds=None) is None


def test_stale_negative_is_checked_again(pg_db):
    store_lyrics("Defeater", "Silence", found=False)
    _age_lyrics("Defeater", "Silence", days=40)

    with patch(
        "crate.lyrics.requests.get",
        return_value=_Response(200, {"syncedLyrics": None, "plainLyrics": "Found"}),
    ) as live_fetch:
        result = get_or_fetch_lyrics("Defeater", "Silence")

    live_fetch.assert_called_once()
    assert result == {"syncedLyrics": None, "plainLyrics": "Found"}


def test_successful_check_refreshes_freshness_without_changing_content(pg_db):
    store_lyrics("Defeater", "Cowardice", synced_lyrics="[00:01.00]Same")
    _age_lyrics("Defeater", "Cowardice", days=40)

    merged = merge_lyrics("Defeater", "Cowardice", plain_lyrics="Worse")

    assert merged["syncedLyrics"] == "[00:01.00]Same"
    assert get_cached_lyrics("Defeater", "Cowardice") is not None


def test_merge_negative_never_erases_content(pg_db):
    store_lyrics("Defeater", "Empty Glass", plain_lyrics="Words")

    merged = merge_lyrics("Defeater", "Empty Glass", found=False)

    assert merged["plainLyrics"] == "Words"
    assert merged["found"] is True


def _library_tracks(tmp_path, titles: list[str]) -> dict[str, int]:
    album_dir = tmp_path / "Defeater" / "Travels"
    album_dir.mkdir(parents=True)
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists (name, updated_at) VALUES ('Defeater', NOW())"
            )
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, track_count, updated_at)
                VALUES ('Defeater', 'Travels', :path, :count, NOW())
                RETURNING id
                """
            ),
            {"path": str(album_dir), "count": len(titles)},
        ).scalar_one()
        ids = {}
        for index, title in enumerate(titles, start=1):
            ids[title] = session.execute(
                text(
                    """
                    INSERT INTO library_tracks (album_id, artist, album, filename, title, path, updated_at)
                    VALUES (:album_id, 'Defeater', 'Travels', :filename, :title, :path, NOW())
                    RETURNING id
                    """
                ),
                {
                    "album_id": album_id,
                    "filename": f"{index:02d} {title}.flac",
                    "title": title,
                    "path": str(album_dir / f"{index:02d} {title}.flac"),
                },
            ).scalar_one()
    return ids


def test_list_tracks_for_lyrics_selects_by_refresh_mode(pg_db, tmp_path):
    ids = _library_tracks(
        tmp_path,
        [
            "Fresh Plain",
            "Fresh Negative",
            "Stale Negative",
            "Stale Synced",
            "Fresh Synced",
            "No Row",
        ],
    )
    store_lyrics(
        "Defeater", "Fresh Plain", plain_lyrics="p", track_id=ids["Fresh Plain"]
    )
    store_lyrics(
        "Defeater", "Fresh Negative", found=False, track_id=ids["Fresh Negative"]
    )
    store_lyrics(
        "Defeater", "Stale Negative", found=False, track_id=ids["Stale Negative"]
    )
    store_lyrics(
        "Defeater",
        "Stale Synced",
        synced_lyrics="[00:01.00]s",
        track_id=ids["Stale Synced"],
    )
    store_lyrics(
        "Defeater",
        "Fresh Synced",
        synced_lyrics="[00:01.00]s",
        track_id=ids["Fresh Synced"],
    )
    _age_lyrics("Defeater", "Stale Negative", days=40)
    _age_lyrics("Defeater", "Stale Synced", days=40)

    def selected(mode: str) -> set[str]:
        rows = list_tracks_for_lyrics(artist="Defeater", refresh_mode=mode, limit=50)
        return {row["title"] for row in rows}

    assert selected("missing") == {"Stale Negative", "No Row"}
    assert selected("due") == {"Stale Negative", "Stale Synced", "No Row"}
    assert selected("upgrade") == {
        "Fresh Plain",
        "Fresh Negative",
        "Stale Negative",
        "No Row",
    }
    assert selected("all") == set(ids)
    with pytest.raises(ValueError):
        list_tracks_for_lyrics(artist="Defeater", refresh_mode="everything")


def test_list_tracks_for_lyrics_uses_injected_clock(pg_db, tmp_path):
    ids = _library_tracks(tmp_path, ["Negative"])
    store_lyrics("Defeater", "Negative", found=False, track_id=ids["Negative"])

    future = datetime(2100, 1, 1, tzinfo=timezone.utc)
    rows = list_tracks_for_lyrics(artist="Defeater", refresh_mode="missing", now=future)

    assert [row["title"] for row in rows] == ["Negative"]


@pytest.mark.parametrize(
    ("params", "query_mode", "sync_force"),
    [
        ({}, "missing", False),
        ({"refresh_mode": "due"}, "due", False),
        ({"refresh_mode": "upgrade"}, "upgrade", True),
        ({"refresh_mode": "due", "force": True}, "all", True),
    ],
)
def test_sync_lyrics_handler_maps_refresh_mode(
    monkeypatch, params, query_mode, sync_force
):
    from crate.worker_handlers import enrichment

    captured: dict = {}

    def fake_list(**kwargs):
        captured["query"] = kwargs
        return [{"id": 1, "artist": "Defeater", "title": "Dear Father"}]

    def fake_sync(tracks, **kwargs):
        captured["sync"] = kwargs
        return {"tracks": 1, "found": 1, "missing": 0, "skipped": 0, "errors": 0}

    monkeypatch.setattr("crate.db.queries.lyrics.list_tracks_for_lyrics", fake_list)
    monkeypatch.setattr("crate.lyrics.sync_lyrics_for_tracks", fake_sync)
    monkeypatch.setattr(enrichment, "emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr(enrichment, "emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(enrichment, "is_cancelled", lambda task_id: False)

    enrichment._handle_sync_lyrics("task-1", {"album_id": 3, **params}, {})

    assert captured["query"]["refresh_mode"] == query_mode
    assert captured["query"]["album_id"] == 3
    assert captured["sync"]["force"] is sync_force


def test_sync_lyrics_for_tracks_never_degrades_existing_lyrics(pg_db):
    store_lyrics("Defeater", "Blessed Burden", synced_lyrics="[00:01.00]Kept")
    tracks = [{"id": None, "artist": "Defeater", "title": "Blessed Burden"}]

    with patch("crate.lyrics.requests.get", return_value=_Response(404)):
        result = sync_lyrics_for_tracks(tracks, force=True, delay_seconds=0)

    assert result["found"] == 1
    cached = get_cached_lyrics("Defeater", "Blessed Burden")
    assert cached["syncedLyrics"] == "[00:01.00]Kept"


def test_lyrics_sync_request_accepts_known_refresh_modes():
    from crate.api.schemas.management import LyricsSyncRequest

    assert LyricsSyncRequest().refresh_mode == "missing"
    assert LyricsSyncRequest(album_id=1, refresh_mode="due").refresh_mode == "due"
    with pytest.raises(ValidationError):
        LyricsSyncRequest(refresh_mode="everything")
