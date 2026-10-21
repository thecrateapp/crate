"""Exact bounded Tidal artist acquisition contract tests; no live provider calls."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from crate import agent_acquisition
from crate.agent_diagnostics import DiagnosticError
from crate.mcp.acquisition_schemas import TidalMissingSearch


def _album(index, title=None):
    return {
        "id": str(800000 + index),
        "title": title or f"Release {index}",
        "artist": "Fontaines D.C.",
        "year": "2025",
        "release_date": f"2025-0{index % 9 + 1}-01",
        "tracks": 10,
        "type": "ALBUM",
        "catalog_offset": index,
        "quality": ["HI_RES_LOSSLESS"],
    }


def _source(index):
    return agent_acquisition._tidal_album_source(
        {"entity_uid": str(uuid4()), "name": "Fontaines D.C."},
        _album(index),
        "12345",
    )


def test_tidal_artist_search_mints_one_receipt_for_complete_missing_catalog(
    monkeypatch,
):
    principal = object()
    artist = {"entity_uid": str(uuid4()), "name": "Fontaines D.C."}
    provider_artist = {"id": "12345", "name": "Fontaines D.C."}
    albums = [_album(index) for index in range(3)]
    receipts = []
    monkeypatch.setattr(agent_acquisition.store, "authorize_search", lambda _p: None)
    monkeypatch.setattr(
        agent_acquisition,
        "_resolve_local_tidal_artist",
        lambda _name: ((artist, provider_artist), []),
    )
    monkeypatch.setattr(
        agent_acquisition, "_tidal_discography", lambda _id: (albums, True)
    )
    monkeypatch.setattr(
        "crate.db.queries.subsonic_artist_album_queries.get_albums_by_artist_name",
        lambda _name: [{"name": "Release 1"}],
    )

    def save(_principal, sources):
        receipts.extend(sources)
        return [{"receipt_id": str(uuid4()), "source": sources[0]}]

    monkeypatch.setattr(agent_acquisition.store, "save_receipts", save)

    result = agent_acquisition.search_tidal_missing_artist(
        principal, artist="Fontaines D.C."
    )["data"]

    assert result["coverage"] == "complete"
    assert result["missing_count"] == 2
    assert [row["title"] for row in result["releases"]] == [
        "Release 2",
        "Release 0",
    ]
    assert len(receipts) == 1
    assert receipts[0]["provider"] == "tidal_artist_batch"
    assert len(receipts[0]["releases"]) == 2
    assert result["download_started"] is False


def test_tidal_artist_search_never_mints_a_partial_catalog_receipt(monkeypatch):
    artist = {"entity_uid": str(uuid4()), "name": "Fontaines D.C."}
    albums = [_album(index) for index in range(51)]
    saved = []
    monkeypatch.setattr(agent_acquisition.store, "authorize_search", lambda _p: None)
    monkeypatch.setattr(
        agent_acquisition,
        "_resolve_local_tidal_artist",
        lambda _name: ((artist, {"id": "12345", "name": artist["name"]}), []),
    )
    monkeypatch.setattr(
        agent_acquisition, "_tidal_discography", lambda _id: (albums, True)
    )
    monkeypatch.setattr(
        "crate.db.queries.subsonic_artist_album_queries.get_albums_by_artist_name",
        lambda _name: [],
    )
    monkeypatch.setattr(
        agent_acquisition.store,
        "save_receipts",
        lambda *_args: saved.append(True),
    )

    result = agent_acquisition.search_tidal_missing_artist(
        object(), artist=artist["name"]
    )["data"]

    assert result["resolution"] == "missing_release_limit_exceeded"
    assert result["coverage"] == "complete_catalog_more_than_50_missing"
    assert result["missing_count"] == 51
    assert result["download_started"] is False
    assert result["receipt_created"] is False
    assert saved == []


def test_tidal_artist_search_exposes_ambiguous_provider_candidates(monkeypatch):
    artist = {"entity_uid": str(uuid4()), "name": "Fontaines D.C."}
    monkeypatch.setattr(agent_acquisition.store, "authorize_search", lambda _p: None)
    monkeypatch.setattr(
        "crate.db.queries.agent_library.read_artist_evidence",
        lambda **_kwargs: {"artists": [artist]},
    )
    monkeypatch.setattr("crate.tidal.is_authenticated", lambda: True)
    monkeypatch.setattr(
        "crate.tidal.search",
        lambda *_args, **_kwargs: {
            "artists": [
                {"id": "12345", "name": artist["name"]},
                {"id": "67890", "name": artist["name"]},
            ]
        },
    )
    monkeypatch.setattr(
        agent_acquisition.store,
        "save_receipts",
        lambda *_args: pytest.fail("ambiguous artists must not mint receipts"),
    )

    result = agent_acquisition.search_tidal_missing_artist(
        object(), artist=artist["name"]
    )["data"]

    assert result["resolution"] == "ambiguous"
    assert [row["tidal_artist_id"] for row in result["provider_artists"]] == [
        "12345",
        "67890",
    ]
    assert result["download_started"] is False


def test_single_album_search_schema_allows_fifty_results():
    assert (
        TidalMissingSearch.model_validate(
            {"artist": "Fontaines D.C.", "limit": 50}
        ).limit
        == 50
    )
    with pytest.raises(ValidationError):
        TidalMissingSearch.model_validate({"artist": "Fontaines D.C.", "limit": 51})


def test_single_tidal_search_accepts_fifty_results(monkeypatch):
    artist = {"entity_uid": str(uuid4()), "name": "Fontaines D.C."}
    albums = [_album(index) for index in range(50)]
    monkeypatch.setattr(agent_acquisition.store, "authorize_search", lambda _p: None)
    monkeypatch.setattr(
        "crate.db.queries.agent_library.read_artist_evidence",
        lambda **_kwargs: {"artists": [artist]},
    )
    monkeypatch.setattr(
        "crate.db.queries.subsonic_artist_album_queries.get_albums_by_artist_name",
        lambda _name: [],
    )
    monkeypatch.setattr("crate.tidal.is_authenticated", lambda: True)
    monkeypatch.setattr(
        "crate.tidal.search",
        lambda *_args, **_kwargs: {
            "artists": [{"id": "12345", "name": artist["name"]}]
        },
    )
    monkeypatch.setattr(
        "crate.tidal.get_artist_albums", lambda *_args, **_kwargs: albums
    )
    monkeypatch.setattr(
        agent_acquisition.store,
        "save_receipts",
        lambda _p, sources: [
            {"receipt_id": str(uuid4()), "source": source} for source in sources
        ],
    )

    result = agent_acquisition.search_tidal_missing_albums(
        object(), artist=artist["name"], limit=50
    )["data"]

    assert len(result["results"]) == 50
    assert result["download_started"] is False


def test_tidal_discography_uses_offsets_and_stops_at_observed_end(monkeypatch):
    from crate import tidal

    calls = []

    def page(_artist_id, *, limit, offset, strict):
        calls.append((limit, offset, strict))
        count = 50 if offset < 100 else 3
        return [_album(offset + index) for index in range(count)]

    monkeypatch.setattr(tidal, "get_artist_albums", page)

    albums, complete = agent_acquisition._tidal_discography("12345")

    assert complete is True
    assert len(albums) == 103
    assert [row["catalog_offset"] for row in albums[:2]] == [0, 1]
    assert albums[-1]["catalog_offset"] == 102
    assert calls == [(50, 0, True), (50, 50, True), (50, 100, True)]


def test_tidal_discography_refuses_to_claim_coverage_beyond_500(monkeypatch):
    from crate import tidal

    calls = []

    def page(_artist_id, *, limit, offset, strict):
        calls.append(offset)
        return [_album(offset + index) for index in range(limit)]

    monkeypatch.setattr(tidal, "get_artist_albums", page)

    albums, complete = agent_acquisition._tidal_discography("12345")

    assert complete is False
    assert len(albums) == 550
    assert calls == list(range(0, 550, 50))


def test_get_artist_albums_passes_provider_offset(monkeypatch):
    from crate import tidal

    captured = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {
                "items": [
                    {
                        "id": 123,
                        "title": "Release",
                        "artist": {"name": "Fontaines D.C."},
                        "numberOfTracks": 10,
                    }
                ]
            }

    monkeypatch.setattr(tidal, "get_auth_token", lambda: "test-token")
    monkeypatch.setattr(
        "crate.tidal.requests.get",
        lambda _url, **kwargs: captured.update(kwargs) or Response(),
    )

    result = tidal.get_artist_albums("12345", limit=1, offset=50, strict=True)

    assert captured["params"]["offset"] == 50
    assert result[0]["catalog_offset"] == 50


def test_tidal_artist_batch_revalidation_requires_exact_missing_set(monkeypatch):
    artist_uid = str(uuid4())
    albums = [_album(0), _album(1)]
    releases = [
        agent_acquisition._tidal_album_source(
            {"entity_uid": artist_uid, "name": "Fontaines D.C."}, item, "12345"
        )
        for item in albums
    ]
    releases.sort(
        key=lambda row: (row["release_date"], row["year"], row["title"].casefold()),
        reverse=True,
    )
    batch = {
        "provider": "tidal_artist_batch",
        "tidal_artist_id": "12345",
        "artist_uid": artist_uid,
        "artist": "Fontaines D.C.",
        "catalog_entries_seen": 2,
        "releases": releases,
    }
    monkeypatch.setattr("crate.tidal.is_authenticated", lambda: True)
    monkeypatch.setattr(
        "crate.tidal.search",
        lambda *_args, **_kwargs: {
            "artists": [{"id": "12345", "name": "Fontaines D.C."}]
        },
    )
    monkeypatch.setattr(
        agent_acquisition,
        "_tidal_discography",
        lambda _id: (albums, True),
    )
    monkeypatch.setattr(
        "crate.db.queries.subsonic_artist_album_queries.get_albums_by_artist_name",
        lambda _name: [],
    )

    agent_acquisition._validate_tidal_artist_batch(batch)
    batch["releases"] = [releases[0]]
    with pytest.raises(DiagnosticError) as error:
        agent_acquisition._validate_tidal_artist_batch(batch)
    assert error.value.code == "EVIDENCE_STALE"


def test_preview_and_apply_artist_wrappers_bind_operation(monkeypatch):
    calls = []
    monkeypatch.setattr(
        agent_acquisition,
        "prepare_operation",
        lambda principal, operation, params, key, **kwargs: (
            calls.append((principal, operation, params, key, kwargs))
            or {"prepared": True}
        ),
    )
    monkeypatch.setattr(
        agent_acquisition,
        "_apply",
        lambda principal, operation, plan, version, key, **kwargs: (
            calls.append((principal, operation, plan, version, key, kwargs))
            or {"applied": True}
        ),
    )
    principal = object()
    receipt = str(uuid4())
    plan = str(uuid4())
    key = "approval-1"

    assert agent_acquisition.preview_tidal_artist_acquisition(
        principal, receipt_id=receipt, idempotency_key=key
    ) == {"prepared": True}
    assert agent_acquisition.apply_tidal_artist_acquisition(
        principal, plan_id=plan, plan_version="a" * 64, idempotency_key=key
    ) == {"applied": True}
    assert calls[0][1:4] == (
        "tidal_artist_acquisition",
        {"receipt_id": receipt, "quality": "max"},
        key,
    )
    assert calls[1][1:5] == ("tidal_artist_acquisition", plan, "a" * 64, key)


def test_artist_batch_plan_binds_every_release(monkeypatch):
    principal = object()
    artist_uid = str(uuid4())
    releases = []
    for index in range(3):
        release = _source(index)
        release["artist_uid"] = artist_uid
        releases.append(release)
    batch = {
        "provider": "tidal_artist_batch",
        "tidal_artist_id": "12345",
        "artist_uid": artist_uid,
        "artist": "Fontaines D.C.",
        "catalog_entries_seen": 3,
        "releases": releases,
    }
    monkeypatch.setattr(
        agent_acquisition.store,
        "read_receipt",
        lambda *_args: {
            "source": batch,
            "expires_at": datetime.now(timezone.utc),
        },
    )
    monkeypatch.setattr(
        agent_acquisition, "_validate_tidal_artist_batch", lambda _s: None
    )
    monkeypatch.setattr(
        agent_acquisition.store,
        "target_state",
        lambda *_args: {"name": "Fontaines D.C."},
    )
    monkeypatch.setattr(agent_acquisition, "_local_album_present", lambda *_args: False)

    compiled = agent_acquisition.compile_operation(
        "tidal_artist_acquisition",
        {"receipt_id": str(uuid4()), "quality": "max"},
        {},
        principal=principal,
    )

    plan_releases = compiled["document"]["changes"][0]["releases"]
    assert [item["tidal_album_id"] for item in plan_releases] == [
        item["tidal_album_id"] for item in releases
    ]
    assert (
        compiled["document"]["impact"]["scope"] == "complete_missing_tidal_discography"
    )


def test_artist_batch_stops_on_first_failure_and_reports_partial(monkeypatch):
    artist_uid = str(uuid4())
    releases = []
    for index in range(3):
        release = _source(index)
        release["artist_uid"] = artist_uid
        releases.append(release)
    source = {
        "provider": "tidal_artist_batch",
        "tidal_artist_id": "12345",
        "artist_uid": artist_uid,
        "artist": "Fontaines D.C.",
        "catalog_entries_seen": 3,
        "releases": releases,
    }
    imported = set()
    calls = []
    monkeypatch.setattr(
        agent_acquisition.store,
        "execution_receipt",
        lambda *_args: {"source": source},
    )
    monkeypatch.setattr(
        agent_acquisition, "_validate_tidal_artist_batch", lambda _s: None
    )
    monkeypatch.setattr(agent_acquisition, "_validate_tidal_source", lambda _s: None)
    monkeypatch.setattr(
        agent_acquisition.store,
        "target_state",
        lambda *_args: {"name": "Fontaines D.C."},
    )
    monkeypatch.setattr(
        agent_acquisition,
        "_local_album_present",
        lambda _artist, title: title in imported,
    )

    def download(task_id, params, _config, *, authorize):
        calls.append(params["album"])
        if len(calls) == 2:
            return {"success": False}
        imported.add(params["album"])
        return {"success": True}

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._handle_tidal_download", download
    )
    scans = []
    monkeypatch.setattr("crate.worker_handlers.start_scan", lambda: scans.append(True))

    result = agent_acquisition.apply_operation(
        "tidal_artist_acquisition",
        {
            "source": source,
            "receipt_id": str(uuid4()),
            "quality": "max",
            "target": {"name": "Fontaines D.C."},
        },
        {},
        task_id="operation-1",
        authorize=lambda effect=None: effect() if effect else None,
    )

    assert result["execution"]["status"] == "partial"
    assert result["execution"]["completed_count"] == 1
    assert result["execution"]["items"][-1]["album"] == "Release 1"
    assert result["execution"]["items"][-1]["status"] == "failed"
    assert calls == ["Release 0", "Release 1"]
    assert scans == [True]

    from crate.agent_operation_catalog import operation_result_summary

    summary = operation_result_summary(result)
    assert summary["outcome_count"] == 2
    assert summary["outcome_status_counts"] == {"verified": 1, "failed": 1}
    assert summary["execution"]["completed_count"] == 1


def test_artist_batch_cancellation_after_a_release_keeps_exact_partial_outcome(
    monkeypatch,
):
    artist_uid = str(uuid4())
    releases = [_source(index) for index in range(2)]
    for release in releases:
        release["artist_uid"] = artist_uid
    source = {
        "provider": "tidal_artist_batch",
        "tidal_artist_id": "12345",
        "artist_uid": artist_uid,
        "artist": "Fontaines D.C.",
        "catalog_entries_seen": 2,
        "releases": releases,
    }
    imported = set()
    calls = []
    authorize_calls = 0
    monkeypatch.setattr(
        agent_acquisition.store,
        "execution_receipt",
        lambda *_args: {"source": source},
    )
    monkeypatch.setattr(
        agent_acquisition, "_validate_tidal_artist_batch", lambda _s: None
    )
    monkeypatch.setattr(agent_acquisition, "_validate_tidal_source", lambda _s: None)
    monkeypatch.setattr(
        agent_acquisition.store,
        "target_state",
        lambda *_args: {"name": "Fontaines D.C."},
    )
    monkeypatch.setattr(
        agent_acquisition,
        "_local_album_present",
        lambda _artist, title: title in imported,
    )

    def download(_task_id, params, _config, *, authorize):
        calls.append(params["album"])
        imported.add(params["album"])
        return {"success": True}

    def authorize(effect=None):
        nonlocal authorize_calls
        authorize_calls += 1
        if authorize_calls == 3:
            raise DiagnosticError("CANCELLED", "cancel requested")
        return effect() if effect else None

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._handle_tidal_download", download
    )
    scans = []
    monkeypatch.setattr("crate.worker_handlers.start_scan", lambda: scans.append(True))

    result = agent_acquisition.apply_operation(
        "tidal_artist_acquisition",
        {
            "source": source,
            "receipt_id": str(uuid4()),
            "quality": "max",
            "target": {"name": "Fontaines D.C."},
        },
        {},
        task_id="operation-2",
        authorize=authorize,
    )

    assert result["execution"]["status"] == "partial"
    assert result["execution"]["completed_count"] == 1
    assert result["execution"]["items"][-1]["error_code"] == "CANCELLED"
    assert calls == [releases[0]["title"]]
    assert scans == [True]
