from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import text

from crate.db.queries.browse_media_search import (
    DjSearchQuery,
    dj_search_statement,
    parse_dj_query,
    search_dj_tracks,
)
from crate.db.tx import transaction_scope


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


def test_parse_extracts_filters_and_keeps_free_text() -> None:
    query = parse_dj_query(
        'noah artist:"Birds In Row" album:gris bpm:120-128 key:8a energy:0.5-0.9'
    )

    assert query == DjSearchQuery(
        text="noah",
        artist="Birds In Row",
        album="gris",
        bpm_min=120.0,
        bpm_max=128.0,
        camelot="8A",
        energy_min=0.5,
        energy_max=0.9,
        analyzed=None,
    )


def test_parse_single_bpm_becomes_a_narrow_range_and_analyzed_flag() -> None:
    query = parse_dj_query("bpm:124 analyzed:no")

    assert query.bpm_min == 123.0
    assert query.bpm_max == 125.0
    assert query.analyzed is False
    assert query.text == ""


@pytest.mark.parametrize(
    "raw",
    ["bpm:fast", "bpm:130-120", "key:13A", "key:8C", "energy:2", "analyzed:maybe"],
)
def test_parse_rejects_invalid_filters(raw: str) -> None:
    with pytest.raises(ValueError):
        parse_dj_query(raw)


def test_plain_text_without_syntax_is_not_a_dj_query() -> None:
    assert parse_dj_query("birds in row").has_filters is False
    assert parse_dj_query("bpm:120").has_filters is True


def test_dj_search_filters_by_profile_bpm_key_and_energy(pg_db, tmp_path: Path) -> None:
    del pg_db
    tracks = _library(
        tmp_path,
        [
            ("Alpha", 124.0, "8A", 0.7),
            ("Beta", 124.0, "9A", 0.7),
            ("Gamma", 140.0, "8A", 0.7),
            ("Delta", 124.0, "8A", 0.2),
            ("Epsilon", None, None, None),
        ],
    )

    results = search_dj_tracks("bpm:120-128 key:8A energy:0.5-1", 50)

    assert [item["title"] for item in results] == ["Alpha"]
    assert results[0]["camelot"] == "8A"
    assert results[0]["analysis_required"] is False
    assert "path" not in results[0]
    assert results[0]["entity_uid"] == tracks["Alpha"]


def test_dj_search_combines_free_text_and_artist_filters(pg_db, tmp_path: Path) -> None:
    del pg_db
    _library(
        tmp_path,
        [("Shame", 120.0, "8A", 0.6), ("Bliss", 120.0, "8A", 0.6)],
        artist="High Vis",
    )
    _library(tmp_path, [("Shame", 120.0, "8A", 0.6)], artist="Other Band")

    results = search_dj_tracks('shame artist:"high vis"', 50)

    assert [(item["title"], item["artist"]) for item in results] == [
        ("Shame", _ARTISTS["High Vis"])
    ]


def test_dj_search_finds_tracks_that_still_need_analysis(pg_db, tmp_path: Path) -> None:
    del pg_db
    _library(
        tmp_path,
        [("Analysed", 120.0, "8A", 0.5), ("Pending", None, None, None)],
        artist="Needs Analysis",
    )

    results = search_dj_tracks('artist:"needs analysis" analyzed:no', 50)

    assert [item["title"] for item in results] == ["Pending"]
    assert results[0]["analysis_required"] is True


def test_dj_search_caps_results_at_50(pg_db, tmp_path: Path) -> None:
    del pg_db
    _library(tmp_path, [(f"Track {index}", 122.0, "8A", 0.5) for index in range(60)])

    assert len(search_dj_tracks("bpm:120-124", 500)) == 50


def test_profile_filters_use_the_profile_indexes_at_scale(
    pg_db, tmp_path: Path
) -> None:
    del pg_db
    _library(
        tmp_path,
        [(f"Scale {index}", 80.0 + index % 100, "8A", 0.5) for index in range(6_000)],
    )
    statement, params = dj_search_statement(parse_dj_query("bpm:120-124 key:8A"), 50)

    with transaction_scope() as session:
        session.execute(text("ANALYZE track_mix_profiles"))
        session.execute(text("ANALYZE library_tracks"))
        session.execute(text("SET LOCAL random_page_cost = 1.0"))
        raw_plan = session.execute(
            text(f"EXPLAIN (FORMAT JSON) {statement.text}"), params
        ).scalar_one()

    assert not _has_seq_scan(raw_plan, "library_tracks")
    assert not _has_seq_scan(raw_plan, "track_mix_profiles")


async def _token_user(_middleware, _request):
    return {
        "id": 7,
        "email": "dj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.catalog.read"],
    }


def test_dj_fields_search_returns_tracks_only(test_app) -> None:
    tracks = [{"id": 1, "title": "Alpha", "artist": "A", "album": "B", "camelot": "8A"}]
    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _token_user),
        patch(
            "crate.api.browse_media.search_dj_tracks", return_value=tracks
        ) as dj_search,
    ):
        response = test_app.get("/api/search?q=bpm:120-128&fields=dj&limit=80")

    assert response.status_code == 200
    assert response.json()["artists"] == []
    assert response.json()["tracks"][0]["camelot"] == "8A"
    dj_search.assert_called_once_with("bpm:120-128", 50)


def test_invalid_dj_syntax_is_a_client_error(test_app) -> None:
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _token_user):
        response = test_app.get("/api/search?q=bpm:fast&fields=dj")

    assert response.status_code == 400


def test_access_token_search_never_returns_server_paths(test_app) -> None:
    payload = {
        "artists": [],
        "albums": [],
        "tracks": [
            {"id": 1, "title": "Noah", "artist": "A", "album": "B", "path": "/music/x"}
        ],
    }
    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _token_user),
        patch("crate.api.browse_media.search_local_library", return_value=payload),
    ):
        response = test_app.get("/api/search?q=noah")

    assert response.status_code == 200
    assert "path" not in response.json()["tracks"][0]


def test_session_search_keeps_paths_for_listen(test_app) -> None:
    payload = {
        "artists": [],
        "albums": [],
        "tracks": [
            {"id": 1, "title": "Noah", "artist": "A", "album": "B", "path": "/music/x"}
        ],
    }
    with patch("crate.api.browse_media.search_local_library", return_value=payload):
        response = test_app.get("/api/search?q=noah")

    assert response.status_code == 200
    assert response.json()["tracks"][0]["path"] == "/music/x"


_ARTISTS: dict[str, str] = {}


def _library(
    tmp_path: Path,
    tracks: list[tuple[str, float | None, str | None, float | None]],
    *,
    artist: str = "DJ Search",
) -> dict[str, str]:
    suffix = uuid.uuid4().hex
    artist_name = f"{artist} {suffix[:6]}"
    _ARTISTS[artist] = artist_name
    created: dict[str, str] = {}
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists (name, entity_uid) "
                "VALUES (:artist, CAST(:uid AS uuid))"
            ),
            {"artist": artist_name, "uid": str(uuid.uuid4())},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES (:artist, 'DJ Album', :path, CAST(:uid AS uuid))
                RETURNING id
                """
            ),
            {
                "artist": artist_name,
                "path": str(tmp_path / suffix),
                "uid": str(uuid.uuid4()),
            },
        ).scalar_one()
        for index, (title, bpm, camelot, energy) in enumerate(tracks):
            track_uid = str(uuid.uuid4())
            track_id = session.execute(
                text(
                    """
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path,
                        entity_uid, duration, track_number
                    )
                    VALUES (
                        :album_id, :artist, 'DJ Album', :filename, :title, :path,
                        CAST(:uid AS uuid), 200.0, :number
                    )
                    RETURNING id
                    """
                ),
                {
                    "album_id": album_id,
                    "artist": artist_name,
                    "filename": f"{index}.flac",
                    "title": title,
                    "path": str(tmp_path / suffix / f"{index}.flac"),
                    "uid": track_uid,
                    "number": index,
                },
            ).scalar_one()
            created[title] = track_uid
            if bpm is None:
                continue
            session.execute(
                text(
                    """
                    INSERT INTO track_mix_profiles (
                        track_id, profile_version, profile_revision, analyzer,
                        analyzer_version, source_revision, quality, bpm,
                        key_camelot, global_energy, analyzed_at
                    )
                    VALUES (
                        :track_id, 1, :revision, 'crate-rust', 'smart-mix-audio-v2',
                        :revision, 'full', :bpm, :camelot, :energy, NOW()
                    )
                    """
                ),
                {
                    "track_id": track_id,
                    "revision": f"rev-{track_id}",
                    "bpm": bpm,
                    "camelot": camelot,
                    "energy": energy,
                },
            )
    return created


def _has_seq_scan(plan: object, relation: str) -> bool:
    if isinstance(plan, list):
        return any(_has_seq_scan(item, relation) for item in plan)
    if not isinstance(plan, dict):
        return False
    if plan.get("Node Type") == "Seq Scan" and plan.get("Relation Name") == relation:
        return True
    return any(_has_seq_scan(value, relation) for value in plan.values())


def test_dj_search_never_reads_stale_profiles() -> None:
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[1] / "crate/db/queries/browse_media_search.py"
    ).read_text()

    assert source.count("track_mix_profiles p") == 3
    assert source.count("p.source_stale_at IS NULL") == 3
