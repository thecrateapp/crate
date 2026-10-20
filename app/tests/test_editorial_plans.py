from types import SimpleNamespace

import pytest

from crate.agent_diagnostics import DiagnosticError
from crate.agent_editorial import compile_operation
from crate.db.repositories.editorial_plans import (
    apply_editorial_execution,
    list_editorial_playlists,
    validate_editorial_execution,
)
from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.repositories.playlists_mutate import update_playlist
from crate.db.repositories.playlists_tracks import add_playlist_tracks
from crate.db.repositories.playlists_generation_state import (
    set_generation_status,
)


def _track(pg_db, number):
    pg_db.upsert_artist({"name": "Editorial Test Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Editorial Test Artist",
            "name": "Album",
            "path": "/music/editorial-test",
            "track_count": 2,
            "total_size": 0,
            "formats": ["flac"],
        }
    )
    path = f"/music/editorial-test/{number}.flac"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Editorial Test Artist",
            "album": "Album",
            "filename": f"{number}.flac",
            "title": f"Song {number}",
            "track_number": number,
            "format": "flac",
            "duration": 180,
            "size": 10,
            "path": path,
        }
    )
    return pg_db.get_library_track_by_path(path)


def _compile(parameters):
    return compile_operation(
        "editorial_change", parameters, {}, principal=SimpleNamespace(id="principal")
    )


def test_create_plan_is_private_and_applies_exact_order_once(pg_db):
    first, second = _track(pg_db, 1), _track(pg_db, 2)
    before = {row["id"] for row in list_editorial_playlists(limit=50)["items"]}
    compiled = _compile(
        {
            "kind": "create",
            "name": "Exact",
            "description": "A route",
            "generation_mode": "static",
            "track_uids": [str(second["entity_uid"]), str(first["entity_uid"])],
        }
    )
    assert {row["id"] for row in list_editorial_playlists(limit=50)["items"]} == before
    assert [row["track_uid"] for row in compiled["document"]["selection"]] == [
        str(second["entity_uid"]),
        str(first["entity_uid"]),
    ]
    assert validate_editorial_execution(compiled["execution"])["valid"]

    result = apply_editorial_execution(compiled["execution"])
    assert result["track_count"] == 2
    rows = get_playlist_tracks(result["playlist_id"])
    assert [row["track_entity_uid"] for row in rows] == [
        str(second["entity_uid"]),
        str(first["entity_uid"]),
    ]
    assert all(row["locked"] for row in rows)


def test_existing_lock_and_revision_are_enforced(pg_db):
    first, second = _track(pg_db, 1), _track(pg_db, 2)
    playlist_id = create_playlist("Original", scope="system")
    add_playlist_tracks(
        playlist_id, [{"track_id": first["id"], "source": "manual", "locked": True}]
    )
    with pytest.raises(DiagnosticError, match="Manual and locked"):
        _compile(
            {
                "kind": "edit",
                "playlist_id": playlist_id,
                "generation_mode": "static",
                "track_uids": [str(second["entity_uid"])],
            }
        )
    compiled = _compile(
        {
            "kind": "edit",
            "playlist_id": playlist_id,
            "track_uids": [str(first["entity_uid"]), str(second["entity_uid"])],
        }
    )
    update_playlist(playlist_id, description="Concurrent editor")
    with pytest.raises(DiagnosticError, match="changed"):
        apply_editorial_execution(compiled["execution"])
    assert len(get_playlist_tracks(playlist_id)) == 1


def test_smart_selection_is_frozen_and_refresh_is_separate(pg_db):
    first, second = _track(pg_db, 1), _track(pg_db, 2)
    rules = {
        "match": "all",
        "rules": [{"field": "artist", "op": "eq", "value": "Editorial Test Artist"}],
        "limit": 2,
        "sort": "title",
    }
    compiled = _compile(
        {
            "kind": "create",
            "name": "Smart",
            "generation_mode": "smart",
            "smart_rules": rules,
        }
    )
    assert [row["track_uid"] for row in compiled["document"]["selection"]] == [
        str(first["entity_uid"]),
        str(second["entity_uid"]),
    ]
    result = apply_editorial_execution(compiled["execution"])
    from crate.db.repositories.playlists_collection_reads import get_playlist

    playlist = get_playlist(result["playlist_id"])
    assert playlist["auto_refresh_enabled"] is False
    assert playlist["track_count"] == 2
    policy = _compile(
        {
            "kind": "refresh_policy",
            "playlist_id": result["playlist_id"],
            "auto_refresh_enabled": True,
        }
    )
    policy_result = apply_editorial_execution(policy["execution"])
    assert policy_result["playlist_id"] == result["playlist_id"]
    assert policy_result["auto_refresh_enabled"] is True
    assert policy_result["is_active"] is True
    assert policy_result["track_count"] == 2
    assert get_playlist(result["playlist_id"])["auto_refresh_enabled"] is True


def test_refresh_policy_rejects_concurrent_playlist_change(pg_db):
    from crate.db.repositories.playlists_collection_reads import get_playlist
    from crate.db.repositories.editorial_plans import read_editorial_playlist

    playlist_id = create_playlist(
        "Refresh policy conflict",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2, "sort": "title"},
        auto_refresh_enabled=False,
    )
    compiled = _compile(
        {
            "kind": "refresh_policy",
            "playlist_id": playlist_id,
            "auto_refresh_enabled": True,
        }
    )
    update_playlist(playlist_id, description="Concurrent editor")

    with pytest.raises(DiagnosticError) as conflict:
        apply_editorial_execution(compiled["execution"])

    assert conflict.value.code == "PLAN_STALE"
    assert get_playlist(playlist_id)["auto_refresh_enabled"] is False
    assert read_editorial_playlist(playlist_id, section="history")["items"] == []


def test_old_generation_cannot_overwrite_editorial_apply(pg_db):
    from crate.db.repositories.playlists_tracks import regenerate_playlist_tracks

    first, second = _track(pg_db, 1), _track(pg_db, 2)
    rules = {
        "rules": [{"field": "artist", "op": "eq", "value": "Editorial Test Artist"}],
        "limit": 2,
        "sort": "title",
    }
    playlist_id = create_playlist(
        "Concurrent",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules=rules,
    )
    token = set_generation_status(playlist_id, "running")
    assert token is not None
    planned = _compile(
        {
            "kind": "edit",
            "playlist_id": playlist_id,
            "generation_mode": "static",
            "track_uids": [str(second["entity_uid"])],
        }
    )
    apply_editorial_execution(planned["execution"])
    with pytest.raises(ValueError, match="changed"):
        regenerate_playlist_tracks(
            playlist_id,
            [{"track_id": first["id"]}],
            target_count=1,
            expected_revision=token[0],
            expected_epoch=token[1],
        )
    assert [row["track_entity_uid"] for row in get_playlist_tracks(playlist_id)] == [
        str(second["entity_uid"])
    ]


def test_admin_generation_deduplicates_and_reports_task(pg_db, monkeypatch):
    from fastapi import Request
    from crate.api import system_playlists as api
    from crate.api.schemas.curation import SystemPlaylistGenerateResponse

    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    rules = {
        "rules": [{"field": "artist", "op": "eq", "value": "Editorial Test Artist"}],
        "limit": 2,
        "sort": "title",
    }
    playlist_id = create_playlist(
        "Generate",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules=rules,
    )
    monkeypatch.setattr(api, "_require_playlist_curator", lambda _: {"id": 1})
    request = Request({"type": "http", "method": "POST", "path": "/"})
    first = api.admin_generate_system_playlist(request, playlist_id)
    second = api.admin_generate_system_playlist(request, playlist_id)
    SystemPlaylistGenerateResponse.model_validate(first)
    assert first["task_id"] == second["task_id"]
    assert first["deduplicated"] is False and second["deduplicated"] is True
    assert second["generation_status"] == "queued"


def test_least_played_blueprint_uses_all_time_projection(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.playlists_rule_engine_executor import execute_smart_rules

    first, second = _track(pg_db, 1), _track(pg_db, 2)
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO user_track_stats
            (user_id,stat_window,entity_key,track_id,track_entity_uid,play_count)
            VALUES (1,'all_time','test-least-played',:id,CAST(:uid AS uuid),20)"""),
            {"id": first["id"], "uid": str(first["entity_uid"])},
        )
    tracks = execute_smart_rules(
        {
            "rules": [
                {"field": "artist", "op": "eq", "value": "Editorial Test Artist"}
            ],
            "limit": 2,
            "sort": "least_played",
        }
    )
    assert [item["id"] for item in tracks] == [second["id"], first["id"]]


def test_single_genre_least_played_count_and_selection(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.playlists_rule_engine_executor import execute_smart_rules

    first, second = _track(pg_db, 21), _track(pg_db, 22)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET genre='Noise Rock' WHERE id=ANY(CAST(:ids AS integer[]))"
            ),
            {"ids": [first["id"], second["id"]]},
        )
    rules = {
        "rules": [{"field": "genre", "op": "contains", "value": "Noise"}],
        "limit": 2,
        "sort": "least_played",
    }
    assert execute_smart_rules(rules, count_only=True) == 2
    assert {row["id"] for row in execute_smart_rules(rules)} == {
        first["id"],
        second["id"],
    }


def test_duplicate_retains_manual_rows_and_persistent_exclusions(pg_db):
    from crate.db.repositories.playlists_tracks import remove_playlist_track
    from crate.db.repositories.editorial_plans import read_editorial_playlist

    first, second = _track(pg_db, 1), _track(pg_db, 2)
    playlist_id = create_playlist(
        "Source",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2},
    )
    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "manual", "locked": True},
            {"track_id": second["id"], "source": "generated"},
        ],
    )
    remove_playlist_track(playlist_id, 2, record_exclusion=True)
    compiled = _compile(
        {"kind": "duplicate", "playlist_id": playlist_id, "name": "Copy"}
    )
    copied_id = apply_editorial_execution(compiled["execution"])["playlist_id"]
    copied_rows = get_playlist_tracks(copied_id)
    assert [
        (row["track_entity_uid"], row["source"], row["locked"]) for row in copied_rows
    ] == [(str(first["entity_uid"]), "manual", True)]
    excluded = read_editorial_playlist(copied_id, section="exclusions")
    assert excluded["total"] == 1
    assert excluded["items"][0]["track_uid"] == str(second["entity_uid"])


def test_approval_document_discloses_metadata_and_refresh_policy(pg_db):
    playlist_id = create_playlist(
        "Draft", scope="system", generation_mode="static", auto_refresh_enabled=True
    )
    rules = {"rules": [], "limit": 2, "sort": "title"}
    planned = _compile(
        {
            "kind": "edit",
            "playlist_id": playlist_id,
            "name": "Revised",
            "description": "What the listener will read",
            "generation_mode": "smart",
            "smart_rules": rules,
        }
    )
    change = planned["document"]["changes"][0]
    assert change["description"] == planned["execution"]["description"]
    assert change["generation_mode"] == planned["execution"]["generation_mode"]
    assert change["auto_refresh_before"] is True
    assert change["auto_refresh_after"] is False
    assert planned["document"]["metadata"]["auto_refresh_enabled"] is False
    apply_editorial_execution(planned["execution"])
    from crate.db.repositories.playlists_collection_reads import get_playlist

    assert get_playlist(playlist_id)["auto_refresh_enabled"] is False


def test_scheduler_admission_token_and_stale_queued_generation(pg_db, monkeypatch):
    from sqlalchemy import text
    from crate.db.tx import read_scope
    from crate.db.repositories.playlists_generation_state import (
        enqueue_system_playlist_generation,
    )
    from crate.db.repositories.playlists_collection_reads import get_playlist
    from crate.worker_handlers import management

    track = _track(pg_db, 31)
    playlist_id = create_playlist(
        "Scheduled",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 1},
        auto_refresh_enabled=True,
        is_active=True,
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    queued = enqueue_system_playlist_generation(playlist_id, triggered_by="scheduler")
    repeated = enqueue_system_playlist_generation(playlist_id, triggered_by="scheduler")
    assert repeated["deduplicated"] is True
    assert repeated["task_id"] == queued["task_id"]
    with read_scope() as session:
        params = session.execute(
            text("SELECT params_json FROM tasks WHERE id=:id"),
            {"id": queued["task_id"]},
        ).scalar_one()
    current = get_playlist(playlist_id)
    assert params["expected_revision"] == current["editorial_revision"]
    assert params["expected_epoch"] == current["generation_epoch"]
    monkeypatch.setattr(management, "emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(management, "emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        management, "execute_smart_rules", lambda rules: [{"id": track["id"]}]
    )
    result = management._handle_generate_system_playlist(queued["task_id"], params, {})
    assert result["track_count"] == 1
    assert get_playlist_tracks(playlist_id)[0]["track_entity_uid"] == str(
        track["entity_uid"]
    )

    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text("UPDATE tasks SET status='completed' WHERE id=:id"),
            {"id": queued["task_id"]},
        )
    stale = enqueue_system_playlist_generation(playlist_id, triggered_by="scheduler")
    with read_scope() as session:
        stale_params = session.execute(
            text("SELECT params_json FROM tasks WHERE id=:id"),
            {"id": stale["task_id"]},
        ).scalar_one()
    planned = _compile(
        {
            "kind": "edit",
            "playlist_id": playlist_id,
            "generation_mode": "static",
            "track_uids": [str(track["entity_uid"])],
        }
    )
    apply_editorial_execution(planned["execution"])
    assert (
        management._handle_generate_system_playlist(stale["task_id"], stale_params, {})[
            "status"
        ]
        == "skipped"
    )


def test_new_exclusion_fingerprint_is_rechecked(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.playlists_tracks import add_playlist_tracks

    track = _track(pg_db, 41)
    playlist_id = create_playlist("Exclude", scope="system")
    add_playlist_tracks(playlist_id, [{"track_id": track["id"], "source": "generated"}])
    planned = _compile(
        {
            "kind": "refine",
            "playlist_id": playlist_id,
            "exclude_track_uids": [str(track["entity_uid"])],
        }
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET title='Changed' WHERE id=:id"),
            {"id": track["id"]},
        )
    with pytest.raises(DiagnosticError, match="Excluded library track changed"):
        apply_editorial_execution(planned["execution"])


def test_reenqueue_after_pending_cancel_keeps_generation_token(pg_db, monkeypatch):
    from sqlalchemy import text
    from crate.db.tx import read_scope, transaction_scope
    from crate.db.repositories.playlists_generation_state import (
        enqueue_system_playlist_generation,
    )
    from crate.db.repositories.playlists_collection_reads import get_playlist

    playlist_id = create_playlist(
        "Pending retry",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 1},
        auto_refresh_enabled=True,
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    first = enqueue_system_playlist_generation(playlist_id)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE tasks SET status='cancelled' WHERE id=:id"),
            {"id": first["task_id"]},
        )
    second = enqueue_system_playlist_generation(playlist_id)
    assert second["task_id"] != first["task_id"]
    with read_scope() as session:
        params = session.execute(
            text("SELECT params_json FROM tasks WHERE id=:id"),
            {"id": second["task_id"]},
        ).scalar_one()
    playlist = get_playlist(playlist_id)
    assert params["expected_revision"] == playlist["editorial_revision"]
    assert params["expected_epoch"] == playlist["generation_epoch"]


def test_admin_duplicate_copies_smart_overrides_without_auto_refresh(pg_db):
    from crate.db.repositories.playlists_duplicate import duplicate_playlist
    from crate.db.repositories.playlists_tracks import remove_playlist_track
    from crate.db.repositories.editorial_plans import read_editorial_playlist

    first, second = _track(pg_db, 51), _track(pg_db, 52)
    playlist_id = create_playlist(
        "Admin source",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2},
        auto_refresh_enabled=True,
    )
    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "manual", "locked": True},
            {"track_id": second["id"], "source": "generated"},
        ],
    )
    remove_playlist_track(playlist_id, 2, record_exclusion=True)
    duplicated = duplicate_playlist(playlist_id)
    assert duplicated is not None
    assert duplicated["auto_refresh_enabled"] is False
    rows = get_playlist_tracks(duplicated["id"])
    assert [
        (row["track_entity_uid"], row["source"], row["locked"]) for row in rows
    ] == [(str(first["entity_uid"]), "manual", True)]
    exclusions = read_editorial_playlist(duplicated["id"], section="exclusions")
    assert exclusions["total"] == 1
    assert exclusions["items"][0]["track_uid"] == str(second["entity_uid"])


def test_editorial_exclusion_survives_regeneration_with_global_mapping(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.playlists_tracks import regenerate_playlist_tracks
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    local = _track(pg_db, 61)
    _other, _artist, _album, global_uid = _seed_playlist_and_global_track(pg_db)
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=:id,
                local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
                WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {
                "id": local["id"],
                "uid": str(local["entity_uid"]),
                "global_uid": global_uid,
            },
        )
    playlist_id = create_playlist(
        "Excluded global mapping",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 1},
    )
    add_playlist_tracks(playlist_id, [{"track_id": local["id"], "source": "generated"}])
    planned = _compile(
        {
            "kind": "refine",
            "playlist_id": playlist_id,
            "exclude_track_uids": [str(local["entity_uid"])],
        }
    )
    apply_editorial_execution(planned["execution"])
    assert get_playlist_tracks(playlist_id) == []
    regenerate_playlist_tracks(playlist_id, [{"track_id": local["id"]}], target_count=1)
    assert get_playlist_tracks(playlist_id) == []


@pytest.mark.parametrize("becomes_local", [False, True], ids=["remote", "local"])
@pytest.mark.parametrize("override", ["exclusion", "manual", "locked"])
def test_editorial_regeneration_keeps_global_identity_overrides(
    pg_db, becomes_local, override
):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.editorial_plans import snapshot_system_playlist
    from crate.db.repositories.playlists_tracks import remove_playlist_track
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    first, local, last = (_track(pg_db, number) for number in (81, 82, 83))
    _other, _artist, _album, global_uid = _seed_playlist_and_global_track(pg_db)
    playlist_id = create_playlist(
        "Global override",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={
            "rules": [
                {"field": "artist", "op": "eq", "value": "Editorial Test Artist"}
            ],
            "limit": 4,
            "sort": "title",
        },
    )
    source = "manual" if override == "manual" else "generated"
    locked = override == "locked"
    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "generated"},
            {"global_track_uid": global_uid, "source": source, "locked": locked},
            {"track_id": last["id"], "source": "generated"},
        ],
    )
    original_global_row_id = get_playlist_tracks(playlist_id)[1]["id"]
    if override == "exclusion":
        remove_playlist_track(playlist_id, 2, record_exclusion=True)
    before = snapshot_system_playlist(playlist_id)
    if override == "exclusion":
        assert len(before["exclusions"]) == 1
        assert before["exclusions"][0] == {
            "id": before["exclusions"][0]["id"],
            "track_id": None,
            "track_uid": None,
            "storage_id": None,
            "global_track_uid": global_uid,
            "path": None,
        }

    if becomes_local:
        with transaction_scope() as session:
            session.execute(
                text("""UPDATE global_catalog_tracks SET local_track_id=:id,
                local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
                WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
                {
                    "id": local["id"],
                    "uid": str(local["entity_uid"]),
                    "global_uid": global_uid,
                },
            )

    planned = _compile({"kind": "regenerate", "playlist_id": playlist_id})
    result = apply_editorial_execution(planned["execution"])
    after = snapshot_system_playlist(playlist_id)

    first_identity = (str(first["entity_uid"]), None, "generated", False)
    last_identity = (str(last["entity_uid"]), None, "generated", False)
    local_identity = (str(local["entity_uid"]), None, "generated", False)
    global_identity = (None, global_uid, source, locked)
    if override == "exclusion":
        expected = (
            [first_identity, last_identity]
            if becomes_local
            else [first_identity, local_identity, last_identity]
        )
    else:
        expected = (
            [first_identity, global_identity, last_identity]
            if becomes_local
            else [first_identity, global_identity, local_identity, last_identity]
        )
    for rows in (planned["document"]["selection"], after["tracks"]):
        assert [
            (row["track_uid"], row["global_track_uid"], row["source"], row["locked"])
            for row in rows
        ] == expected
        assert [row["position"] for row in rows] == list(range(1, len(expected) + 1))
        if override != "exclusion":
            assert rows[1]["row_id"] == original_global_row_id
    assert after["exclusions"] == before["exclusions"]
    assert result["track_count"] == after["playlist"]["track_count"] == len(expected)
    for row in after["tracks"]:
        if row["track_uid"]:
            original = next(
                track
                for track in (first, local, last)
                if str(track["entity_uid"]) == row["track_uid"]
            )
            assert row["track_id"] == original["id"]
            assert row["storage_id"] == (
                str(original["storage_id"]) if original["storage_id"] else None
            )
            assert row["path"] == original["path"]
        else:
            assert (row["track_id"], row["storage_id"], row["path"]) == (
                None,
                None,
                None,
            )


@pytest.mark.parametrize("kind", ["edit", "refine"])
@pytest.mark.parametrize(("source", "locked"), [("manual", False), ("generated", True)])
def test_editorial_cannot_exclude_protected_global_row_by_local_uid(
    pg_db, kind, source, locked
):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.editorial_plans import snapshot_system_playlist
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    local = _track(pg_db, 84)
    _other, _artist, _album, global_uid = _seed_playlist_and_global_track(pg_db)
    playlist_id = create_playlist(
        "Protected global override",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2, "sort": "title"},
    )
    add_playlist_tracks(
        playlist_id,
        [{"global_track_uid": global_uid, "source": source, "locked": locked}],
    )
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=:id,
            local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
            WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {
                "id": local["id"],
                "uid": str(local["entity_uid"]),
                "global_uid": global_uid,
            },
        )
    before = snapshot_system_playlist(playlist_id)

    with pytest.raises(DiagnosticError) as protected:
        _compile(
            {
                "kind": kind,
                "playlist_id": playlist_id,
                "exclude_track_uids": [str(local["entity_uid"])],
            }
        )

    assert protected.value.code == "INVALID_ARGUMENT"
    assert snapshot_system_playlist(playlist_id) == before


def test_editorial_edit_and_duplicate_fall_back_to_available_global_track(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    local = _track(pg_db, 71)
    _other, _artist, _album, global_uid = _seed_playlist_and_global_track(pg_db)
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=:id,
            local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
            WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {
                "id": local["id"],
                "uid": str(local["entity_uid"]),
                "global_uid": global_uid,
            },
        )
    playlist_id = create_playlist("Global fallback", scope="system")
    add_playlist_tracks(playlist_id, [{"track_id": local["id"], "locked": True}])
    original_row_id = get_playlist_tracks(playlist_id)[0]["id"]
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE id=:id"), {"id": local["id"]}
        )
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=NULL,
            local_track_entity_uid=NULL,has_local=FALSE,has_remote=TRUE
            WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {"global_uid": global_uid},
        )
    edit = _compile(
        {"kind": "edit", "playlist_id": playlist_id, "description": "Remote source"}
    )
    assert edit["document"]["selection"][0]["global_track_uid"] == global_uid
    apply_editorial_execution(edit["execution"])
    edited_row = get_playlist_tracks(playlist_id)[0]
    assert edited_row["id"] == original_row_id
    assert edited_row["track_entity_uid"] is None
    assert edited_row["global_track_uid"] == global_uid
    copied = _compile({"kind": "duplicate", "playlist_id": playlist_id})
    copied_id = apply_editorial_execution(copied["execution"])["playlist_id"]
    assert get_playlist_tracks(copied_id)[0]["global_track_uid"] == global_uid
