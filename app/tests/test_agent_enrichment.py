from __future__ import annotations

import copy
import json
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate.agent_enrichment import apply_operation, compile_operation
from crate.db.repositories.agent_enrichment import (
    apply_enrichment_result,
    enrichment_state_version,
    read_enrichment_state,
)
from crate.db.repositories.field_locks import lock_fields
from crate.db.repositories.genres_assignments import set_artist_genres
from crate.db.tx import read_scope, transaction_scope


def _authorize(effect=None):
    return effect() if effect is not None else None


@pytest.fixture
def enrichment_artist(pg_db):
    uid = str(uuid4())
    with transaction_scope() as session:
        artist_id = session.execute(
            text(
                "INSERT INTO library_artists(name,entity_uid,bio,tags_json,urls_json,updated_at) "
                "VALUES ('Scoped Artist',CAST(:uid AS uuid),'Existing biography',"
                '\'["existing"]\'::jsonb,\'{"home":"https://artist.example"}\'::jsonb,NOW()) RETURNING id'
            ),
            {"uid": uid},
        ).scalar_one()
        session.execute(
            text(
                "INSERT INTO ui_snapshots(scope,subject_key,payload_json) "
                "VALUES ('library','global','{}'::jsonb) ON CONFLICT DO NOTHING"
            )
        )
    return {"uid": uid, "id": artist_id, "name": "Scoped Artist"}


def _parameters(artist, **overrides):
    return {
        "artist_uids": [artist["uid"]],
        "providers": ["lastfm"],
        "facets": ["biography"],
        "mode": "missing",
        **overrides,
    }


def _plan(artist, **overrides):
    return compile_operation("enrichment", _parameters(artist, **overrides), {})


def _apply(plan, *, authorize=_authorize):
    return apply_operation(
        "enrichment",
        plan["execution"],
        {},
        task_id="scoped-enrichment",
        authorize=authorize,
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"artist_uids": []},
        {"artist_uids": [str(uuid4()) for _ in range(21)]},
        {"artist_uids": ["not-a-uuid"]},
        {"artist_uids": [None]},
        {"artist_uids": "all"},
        {"providers": []},
        {"providers": ["lastfm", "lastfm"]},
        {"providers": ["fanart"]},
        {"providers": ["bandcamp"]},
        {"providers": "lastfm"},
        {"facets": []},
        {"facets": ["biography", "biography"]},
        {"facets": ["photos"]},
        {"facets": ["artwork"]},
        {"facets": [1]},
        {"facets": ["setlists"]},
        {"providers": ["setlist"], "facets": ["biography"]},
        {"mode": "reset"},
        {"force": True},
        {"artist_names": ["Scoped Artist"]},
        {"path": "/music/Scoped Artist"},
    ],
)
def test_invalid_parameters_do_not_resolve_or_fetch_targets(overrides, monkeypatch):
    parameters = _parameters({"uid": str(uuid4())}, **overrides)

    def unexpected_read(*args, **kwargs):
        pytest.fail("Invalid enrichment request reached persistence")

    monkeypatch.setattr("crate.agent_enrichment.read_enrichment_state", unexpected_read)
    with pytest.raises((TypeError, ValueError)):
        compile_operation("enrichment", parameters, {})


def test_duplicate_canonical_uids_are_rejected_before_reads(monkeypatch):
    uid = str(uuid4())
    monkeypatch.setattr(
        "crate.agent_enrichment.read_enrichment_state",
        lambda *_: pytest.fail("Duplicate request reached persistence"),
    )
    with pytest.raises(ValueError, match="Duplicate"):
        compile_operation(
            "enrichment", _parameters({"uid": uid}, artist_uids=[uid, uid.upper()]), {}
        )


def test_unknown_operation_is_rejected_by_prepare_and_apply():
    with pytest.raises(ValueError, match="Unsupported"):
        compile_operation("enrich_everything", {}, {})
    with pytest.raises(ValueError, match="Unsupported"):
        apply_operation(
            "enrich_everything", {}, {}, task_id="job", authorize=_authorize
        )


def test_plan_is_read_only_and_declares_provider_scope_and_unknown_values(
    enrichment_artist, monkeypatch
):
    before = read_enrichment_state(enrichment_artist["uid"])
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch",
        lambda *_: pytest.fail("Planning fetched provider"),
    )
    plan = _plan(
        enrichment_artist,
        providers=["lastfm", "musicbrainz"],
        facets=["biography", "identity", "members"],
        mode="refresh",
    )
    document = plan["document"]
    assert read_enrichment_state(enrichment_artist["uid"]) == before
    assert document["targets"] == [
        {"entity_type": "artist", "entity_uid": enrichment_artist["uid"]}
    ]
    assert document["source_versions"] == {
        enrichment_artist["uid"]: enrichment_state_version(before)
    }
    assert document["impact"]["filesystem"] is False
    assert document["impact"]["implicit_photos"] is False
    assert document["impact"]["external_providers"] == ["lastfm", "musicbrainz"]
    assert document["impact"]["provider_fetches"] == 2
    assert document["risk"] == "caution"
    assert document["impact"]["provider_facets"] == {
        "lastfm": ["biography", "identity"],
        "musicbrainz": ["identity", "members"],
    }
    assert document["impact"]["unsupported_provider_facets"] == {
        "lastfm": ["members"],
        "musicbrainz": ["biography"],
    }
    assert all(
        change["after"] == "provider_result_unknown_until_execution"
        for change in document["changes"]
    )


def test_missing_target_cannot_generate_a_plan(enrichment_artist):
    with pytest.raises(ValueError, match="does not exist"):
        read_enrichment_state(str(uuid4()))
    with pytest.raises(ValueError, match="does not exist"):
        _plan(enrichment_artist, artist_uids=[str(uuid4())])


def test_missing_mode_preserves_populated_values_and_applies_only_empty_unlocked_fields(
    enrichment_artist, monkeypatch
):
    lock_fields(
        entity_type="artist", entity_id=enrichment_artist["id"], field_names=["mbid"]
    )
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch",
        lambda *_: {
            "bio": "Replacement biography",
            "tags": ["new tag"],
            "mbid": str(uuid4()),
            "url": "https://last.fm/artist",
            "listeners": "42",
            "playcount": 0,
        },
    )
    plan = _plan(
        enrichment_artist,
        facets=["biography", "tags", "identity", "urls", "popularity"],
    )
    result = _apply(plan)
    state = read_enrichment_state(enrichment_artist["uid"])
    artist = state["artist"]
    assert artist["bio"] == "Existing biography"
    assert artist["tags_json"] == ["existing"]
    assert artist["mbid"] is None
    assert artist["urls_json"] == {"home": "https://artist.example"}
    assert artist["listeners"] == 42
    assert artist["lastfm_playcount"] == 0
    facets = result["execution"]["items"][0]["providers"][0]["facets"]
    assert {facet["facet"]: facet["status"] for facet in facets} == {
        "biography": "present",
        "tags": "present",
        "identity": "locked",
        "urls": "present",
        "popularity": "applied",
    }
    assert result["verification"]["status"] == "passed"


def test_refresh_preserves_locked_fields_manual_genres_and_other_provider_genres(
    enrichment_artist, monkeypatch
):
    lock_fields(
        entity_type="artist",
        entity_id=enrichment_artist["id"],
        field_names=["bio", "tags"],
    )
    set_artist_genres(
        enrichment_artist["name"],
        [
            ("manual rock", 1, "manual"),
            ("spotify rock", 0.5, "enrichment:spotify"),
            ("old lastfm", 0.8, "enrichment:lastfm"),
        ],
    )
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch",
        lambda *_: {
            "bio": "Replacement biography",
            "tags": ["new lastfm", "manual rock"],
            "url": "https://last.fm/artist",
        },
    )
    plan = _plan(
        enrichment_artist,
        facets=["biography", "tags", "genres", "urls"],
        mode="refresh",
    )
    _apply(plan)
    state = read_enrichment_state(enrichment_artist["uid"])
    assert state["artist"]["bio"] == "Existing biography"
    assert state["artist"]["tags_json"] == ["existing"]
    assert state["artist"]["urls_json"] == {
        "home": "https://artist.example",
        "lastfm": "https://last.fm/artist",
    }
    assert {(row["name"], row["source"]) for row in state["genres"]} == {
        ("manual rock", "manual"),
        ("spotify rock", "enrichment:spotify"),
        ("new lastfm", "enrichment:lastfm"),
    }
    assert {(lock["field_name"], lock["source"]) for lock in state["locks"]} == {
        ("bio", "manual_edit"),
        ("tags", "manual_edit"),
    }


def test_apply_fetches_only_selected_provider_and_does_not_run_full_enrichment(
    enrichment_artist, monkeypatch
):
    from crate import enrichment

    calls = []
    slots = []
    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot",
        lambda *args: slots.append(args),
    )
    monkeypatch.setattr(
        enrichment,
        "_fetch_musicbrainz_payload",
        lambda name: (
            calls.append(name)
            or {"mbid": "f6c8f14f-46b6-49b2-a243-d122635e93e9", "country": "GB"}
        ),
    )

    def unexpected(*args, **kwargs):
        pytest.fail(
            "Scoped enrichment called an unselected provider or photo operation"
        )

    for name in (
        "_fetch_lastfm_payload",
        "_fetch_spotify_payload",
        "_fetch_discogs_payload",
        "_fetch_setlist_payload",
        "_fetch_fanart_payload",
        "_download_artist_photo",
        "_collect_enrichment_payloads",
    ):
        monkeypatch.setattr(enrichment, name, unexpected)
    result = _apply(
        _plan(enrichment_artist, providers=["musicbrainz"], facets=["identity"])
    )
    assert calls == [enrichment_artist["name"]]
    assert slots == [("musicbrainz", 1.1)]
    assert result["execution"]["status"] == "completed"
    assert read_enrichment_state(enrichment_artist["uid"])["artist"]["country"] == "GB"


@pytest.mark.parametrize("change", ["artist", "locks", "genres", "setlists"])
def test_full_source_version_prevents_provider_fetch_after_concurrent_changes(
    enrichment_artist, monkeypatch, change
):
    plan = _plan(enrichment_artist)
    uid = enrichment_artist["uid"]
    if change == "locks":
        lock_fields(
            entity_type="artist", entity_id=enrichment_artist["id"], field_names=["bio"]
        )
    elif change == "genres":
        set_artist_genres(enrichment_artist["name"], [("manual rock", 1, "manual")])
    else:
        with transaction_scope() as session:
            if change == "artist":
                session.execute(
                    text(
                        "UPDATE library_artists SET bio='Concurrent edit' WHERE id=:id"
                    ),
                    {"id": enrichment_artist["id"]},
                )
            else:
                session.execute(
                    text(
                        'INSERT INTO cache(key,value_json,updated_at) VALUES (:key,\'[{"name":"Song"}]\'::jsonb,NOW())'
                    ),
                    {"key": f"agent:enrichment:{uid}:setlists"},
                )
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch",
        lambda *_: pytest.fail("Stale plan fetched provider"),
    )
    result = _apply(plan)
    assert result["execution"]["status"] == "partial"
    assert result["execution"]["items"] == [
        {
            "artist_uid": uid,
            "status": "conflict",
            "code": "SOURCE_CHANGED",
            "providers": [],
        }
    ]


def test_concurrent_manual_edit_during_provider_fetch_is_not_overwritten(
    enrichment_artist, monkeypatch
):
    plan = _plan(enrichment_artist, mode="refresh")

    def fetch(*args):
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_artists SET bio='Manual edit while fetching' WHERE id=:id"
                ),
                {"id": enrichment_artist["id"]},
            )
            lock_fields(
                entity_type="artist",
                entity_id=enrichment_artist["id"],
                field_names=["bio"],
                session=session,
            )
        return {"bio": "Provider biography"}

    monkeypatch.setattr("crate.agent_enrichment._fetch", fetch)
    result = _apply(plan)
    assert read_enrichment_state(enrichment_artist["uid"])["artist"]["bio"] == (
        "Manual edit while fetching"
    )
    assert result["execution"]["status"] == "partial"
    assert result["execution"]["items"][0]["providers"][0]["code"] == "SOURCE_CHANGED"
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM audit_log WHERE task_id='scoped-enrichment'")
            ).scalar_one()
            == 0
        )


def test_provider_failure_is_recoverable_and_does_not_erase_successful_provider_results(
    enrichment_artist, monkeypatch
):
    def fetch(provider, name, facets):
        if provider == "lastfm":
            raise TimeoutError("upstream unavailable")
        return {"mbid": "f6c8f14f-46b6-49b2-a243-d122635e93e9", "country": "GB"}

    monkeypatch.setattr("crate.agent_enrichment._fetch", fetch)
    result = _apply(
        _plan(
            enrichment_artist,
            providers=["lastfm", "musicbrainz"],
            facets=["biography", "identity"],
        )
    )
    providers = result["execution"]["items"][0]["providers"]
    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "partial"
    assert providers[0]["recoverable"] is True
    assert providers[0]["code"] == "PROVIDER_FETCH_FAILED"
    assert providers[1]["status"] == "completed"
    assert read_enrichment_state(enrichment_artist["uid"])["artist"]["country"] == "GB"


def test_each_provider_uses_the_source_version_from_preceding_successful_write(
    enrichment_artist, monkeypatch
):
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch",
        lambda provider, name, facets: (
            {"listeners": 42}
            if provider == "lastfm"
            else {"artist": {"followers": {"total": 120}, "popularity": 78}}
        ),
    )
    result = _apply(
        _plan(
            enrichment_artist,
            providers=["lastfm", "spotify"],
            facets=["popularity"],
        )
    )
    assert result["execution"]["status"] == "completed"
    artist = read_enrichment_state(enrichment_artist["uid"])["artist"]
    assert (
        artist["listeners"],
        artist["spotify_followers"],
        artist["spotify_popularity"],
    ) == (
        42,
        120,
        78,
    )


def test_persisted_fields_have_provider_audit_dirty_projection_and_transactional_invalidation(
    enrichment_artist, monkeypatch
):
    monkeypatch.setattr("crate.agent_enrichment._fetch", lambda *_: {"listeners": "42"})
    _apply(_plan(enrichment_artist, facets=["popularity"]))
    with read_scope() as session:
        audit = (
            session.execute(
                text(
                    "SELECT action,target_name,details_json FROM audit_log WHERE task_id='scoped-enrichment'"
                )
            )
            .mappings()
            .one()
        )
        dirty = session.execute(
            text(
                "SELECT operation FROM global_catalog_dirty_sources WHERE local_entity_uid=CAST(:uid AS uuid)"
            ),
            {"uid": enrichment_artist["uid"]},
        ).scalar_one()
        event = session.execute(
            text(
                "SELECT payload_json FROM domain_event_outbox WHERE event_type='ui.invalidate' AND subject_key=:key"
            ),
            {"key": f"artist:{enrichment_artist['uid']}"},
        ).scalar_one()
        stale = session.execute(
            text(
                "SELECT invalidated_at IS NOT NULL FROM ui_snapshots WHERE scope='library' AND subject_key='global'"
            )
        ).scalar_one()
    assert audit["action"] == "scoped_artist_enrichment"
    assert audit["target_name"] == enrichment_artist["uid"]
    assert audit["details_json"]["source"] == "lastfm"
    assert audit["details_json"]["facets"][0]["after"] == {"listeners": 42}
    assert dirty == "upsert"
    assert event == {"scope": "library"}
    assert stale is True


def test_setlists_are_bounded_durable_and_scoped_to_the_selected_artist(
    enrichment_artist, monkeypatch
):
    payload = [
        {
            "name": "x" * 5000,
            "count": index,
            "private_blob": "secret",
            "probability": float("nan"),
        }
        for index in range(120)
    ]
    monkeypatch.setattr("crate.agent_enrichment._fetch", lambda *_: payload)
    result = _apply(
        _plan(enrichment_artist, providers=["setlist"], facets=["setlists"])
    )
    state = read_enrichment_state(enrichment_artist["uid"])
    assert result["execution"]["status"] == "completed"
    cached = state["setlists"]
    assert len(cached) == 100
    assert cached[0] == {"name": "x" * 4096, "count": 0}
    with read_scope() as session:
        keys = (
            session.execute(
                text("SELECT key FROM cache WHERE key LIKE :pattern"),
                {"pattern": "agent:enrichment:%:setlists"},
            )
            .scalars()
            .all()
        )
    assert keys == [f"agent:enrichment:{enrichment_artist['uid']}:setlists"]


def test_state_fingerprint_covers_locks_genres_and_cached_setlists(enrichment_artist):
    state = read_enrichment_state(enrichment_artist["uid"])
    assert enrichment_state_version(state) == enrichment_state_version(
        copy.deepcopy(state)
    )
    initial = enrichment_state_version(state)
    for key, value in (
        ("locks", [{"field_name": "bio", "source": "manual_edit"}]),
        ("genres", [{"name": "rock", "source": "manual", "weight": 1}]),
        ("setlists", {"setlists": [{"name": "Song"}]}),
    ):
        changed = copy.deepcopy(state)
        changed[key] = value
        assert enrichment_state_version(changed) != initial


def test_repository_write_composes_with_caller_transaction_and_rolls_back_all_effects(
    enrichment_artist,
):
    uid = enrichment_artist["uid"]
    before = read_enrichment_state(uid)
    with pytest.raises(RuntimeError, match="rollback"):
        with transaction_scope() as session:
            result = apply_enrichment_result(
                uid,
                expected_version=enrichment_state_version(before),
                provider="lastfm",
                mode="refresh",
                facets={"biography": {"fields": {"bio": "Provider biography"}}},
                task_id="rollback-enrichment",
                session=session,
            )
            assert result["status"] == "completed"
            assert read_enrichment_state(uid, session=session)["artist"]["bio"] == (
                "Provider biography"
            )
            raise RuntimeError("rollback")
    assert read_enrichment_state(uid) == before
    with read_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM audit_log WHERE task_id='rollback-enrichment'"
                )
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM domain_event_outbox WHERE subject_key=:key"),
                {"key": f"artist:{uid}"},
            ).scalar_one()
            == 0
        )


def test_repository_rejects_stale_source_before_any_write(enrichment_artist):
    uid = enrichment_artist["uid"]
    before = read_enrichment_state(uid)
    result = apply_enrichment_result(
        uid,
        expected_version="old-version",
        provider="lastfm",
        mode="refresh",
        facets={"biography": {"fields": {"bio": "Provider biography"}}},
        task_id="stale-enrichment",
    )
    assert result == {"status": "conflict", "facets": [], "code": "SOURCE_CHANGED"}
    assert read_enrichment_state(uid) == before


def test_authorization_failure_propagates_before_provider_fetch(
    enrichment_artist, monkeypatch
):
    from crate.agent_diagnostics import DiagnosticError

    monkeypatch.setattr(
        "crate.agent_enrichment._fetch", lambda *_: pytest.fail("Unauthorized fetch")
    )

    def rejected(effect=None):
        raise DiagnosticError("AUTHORIZATION_REVOKED", "Revoked")

    with pytest.raises(DiagnosticError):
        _apply(_plan(enrichment_artist), authorize=rejected)


def test_authorization_loss_before_write_keeps_provider_result_unapplied(
    enrichment_artist, monkeypatch
):
    from crate.agent_diagnostics import DiagnosticError

    monkeypatch.setattr("crate.agent_enrichment._fetch", lambda *_: {"listeners": 42})
    effects = 0

    def revoke_after_fetch(effect=None):
        nonlocal effects
        if effect is not None:
            effects += 1
            if effects == 2:
                raise DiagnosticError("AUTHORIZATION_REVOKED", "Revoked")
            return effect()
        return None

    with pytest.raises(DiagnosticError):
        _apply(
            _plan(enrichment_artist, facets=["popularity"]),
            authorize=revoke_after_fetch,
        )
    assert (
        read_enrichment_state(enrichment_artist["uid"])["artist"]["listeners"] is None
    )


def test_spotify_identity_fetch_does_not_query_top_tracks_or_related_artists(
    enrichment_artist, monkeypatch
):
    from crate import spotify

    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    monkeypatch.setattr(
        spotify,
        "search_artist",
        lambda *_: {"id": "spotify-artist", "genres": ["rock"]},
    )

    def unexpected(*args, **kwargs):
        pytest.fail("Identity enrichment requested extra Spotify facets")

    monkeypatch.setattr(spotify, "get_top_tracks", unexpected)
    monkeypatch.setattr(spotify, "get_related_artists", unexpected)
    result = _apply(
        _plan(enrichment_artist, providers=["spotify"], facets=["identity"])
    )
    assert result["execution"]["status"] == "completed"
    state = read_enrichment_state(enrichment_artist["uid"])
    assert state["artist"]["spotify_id"] == "spotify-artist"
    assert state["artist"]["tags_json"] == ["existing"]
    assert not state["artist"]["similar_json"]


@pytest.mark.parametrize("source", ["fresh", "normalized_cache", "explicit_url_cache"])
def test_spotify_urls_from_real_search_preserve_unselected_facets(
    enrichment_artist, monkeypatch, source
):
    from requests import Response

    from crate import spotify

    normalized = {
        "id": "4Z8W4fKeB5YxbusRsdQVPb",
        "name": "Scoped Artist",
        "popularity": 87,
        "followers": 12345,
        "genres": ["provider rock"],
        "images": [{"url": "https://images.example/artist.jpg"}],
    }
    if source == "explicit_url_cache":
        normalized["url"] = (
            "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb?si=preserved"
        )
    cache_key = "spotify:artist:scoped artist"
    cache = {} if source == "fresh" else {cache_key: normalized}

    def cached_artist(key, *, max_age_seconds):
        assert key == cache_key
        assert max_age_seconds == 86400
        return copy.deepcopy(cache.get(key))

    def cache_artist(key, value):
        assert key == cache_key
        cache[key] = copy.deepcopy(value)

    def response(payload):
        result = Response()
        result.status_code = 200
        result._content = json.dumps(payload).encode()
        return result

    def token_request(url, **kwargs):
        assert source == "fresh", "Cached Spotify search made an HTTP request"
        assert url == "https://accounts.spotify.com/api/token"
        return response({"access_token": "fixture-token", "expires_in": 3600})

    def api_request(url, **kwargs):
        assert source == "fresh", "Cached Spotify search made an HTTP request"
        assert url == "https://api.spotify.com/v1/search"
        assert kwargs["params"] == {
            "q": "Scoped Artist",
            "type": "artist",
            "limit": 1,
        }
        return response(
            {
                "artists": {
                    "items": [
                        {
                            **normalized,
                            "followers": {"total": 12345},
                            "external_urls": {
                                "spotify": "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb"
                            },
                        }
                    ]
                }
            }
        )

    monkeypatch.setattr(spotify, "get_cache", cached_artist)
    monkeypatch.setattr(spotify, "set_cache", cache_artist)
    monkeypatch.setattr(spotify, "_token", None)
    monkeypatch.setattr(spotify, "_token_expires", 0)
    monkeypatch.setenv("SPOTIFY_ID", "fixture-client")
    monkeypatch.setenv("SPOTIFY_SECRET", "fixture-secret")
    monkeypatch.setattr(spotify.requests, "post", token_request)
    monkeypatch.setattr(spotify.requests, "get", api_request)
    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    set_artist_genres(
        enrichment_artist["name"],
        [("manual rock", 1, "manual"), ("existing rock", 0.5, "enrichment:spotify")],
    )
    before = read_enrichment_state(enrichment_artist["uid"])

    result = _apply(
        _plan(
            enrichment_artist,
            providers=["spotify"],
            facets=["urls"],
            mode="refresh",
        )
    )

    state = read_enrichment_state(enrichment_artist["uid"])
    expected_url = (
        "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb?si=preserved"
        if source == "explicit_url_cache"
        else "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb"
    )
    assert state["artist"]["urls_json"] == {
        "home": "https://artist.example",
        "spotify": expected_url,
    }
    assert result["execution"]["status"] == "completed"
    assert result["verification"]["status"] == "passed"
    provider = result["execution"]["items"][0]["providers"][0]
    assert provider["provider"] == "spotify"
    assert [(facet["facet"], facet["status"]) for facet in provider["facets"]] == [
        ("urls", "applied")
    ]
    changed_fields = {"urls_json", "enriched_at", "updated_at"}
    assert {
        key: value
        for key, value in state["artist"].items()
        if key not in changed_fields
    } == {
        key: value
        for key, value in before["artist"].items()
        if key not in changed_fields
    }
    assert state["genres"] == before["genres"]
    assert state["locks"] == before["locks"]
    assert state["setlists"] == before["setlists"]


@pytest.mark.parametrize(
    "identifier", [None, "", 12345, "../other?query=value#fragment"]
)
def test_spotify_urls_do_not_construct_links_from_invalid_cached_identifiers(
    enrichment_artist, monkeypatch, identifier
):
    from crate import spotify

    def cached_artist(key, *, max_age_seconds):
        assert key == "spotify:artist:scoped artist"
        return {
            "id": identifier,
            "name": "Scoped Artist",
            "popularity": 87,
            "followers": 12345,
            "genres": ["provider rock"],
            "images": [],
        }

    def unexpected_request(*args, **kwargs):
        pytest.fail("Cached Spotify URL enrichment made an HTTP request")

    monkeypatch.setattr(spotify, "get_cache", cached_artist)
    monkeypatch.setattr(spotify.requests, "get", unexpected_request)
    monkeypatch.setattr(spotify.requests, "post", unexpected_request)
    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    before = read_enrichment_state(enrichment_artist["uid"])

    result = _apply(
        _plan(
            enrichment_artist,
            providers=["spotify"],
            facets=["urls"],
            mode="refresh",
        )
    )

    assert read_enrichment_state(enrichment_artist["uid"]) == before
    facets = result["execution"]["items"][0]["providers"][0]["facets"]
    assert [(facet["facet"], facet["status"]) for facet in facets] == [
        ("urls", "no_data")
    ]


def test_spotify_similarity_fetch_is_explicit_and_preserves_manual_similarity_projection(
    enrichment_artist, monkeypatch
):
    from crate import spotify

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO artist_similarities(artist_name,similar_name,score,source,updated_at) "
                "VALUES (:artist,'Manual Similar',0.99,'manual',NOW())"
            ),
            {"artist": enrichment_artist["name"]},
        )
    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    monkeypatch.setattr(spotify, "search_artist", lambda *_: {"id": "spotify-artist"})
    requested = []
    monkeypatch.setattr(
        spotify,
        "get_related_artists",
        lambda uid: (
            requested.append(uid)
            or [
                {"name": "Manual Similar", "score": 0.1},
                {"name": "New Similar", "score": 0.8},
            ]
        ),
    )
    monkeypatch.setattr(
        spotify, "get_top_tracks", lambda *_: pytest.fail("Unrequested top tracks")
    )
    _apply(_plan(enrichment_artist, providers=["spotify"], facets=["similar_artists"]))
    assert requested == ["spotify-artist"]
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT similar_name,score,source FROM artist_similarities WHERE artist_name=:artist"
                ),
                {"artist": enrichment_artist["name"]},
            )
            .mappings()
            .all()
        )
    assert {row["similar_name"]: (row["score"], row["source"]) for row in rows} == {
        "Manual Similar": (pytest.approx(0.99), "manual"),
        "New Similar": (pytest.approx(0.8), "spotify"),
    }


def test_discogs_identity_fetch_does_not_fetch_artist_details_or_release_catalog(
    enrichment_artist, monkeypatch
):
    from crate import discogs

    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    monkeypatch.setattr(discogs, "is_configured", lambda: True)
    monkeypatch.setattr(discogs, "search_artist", lambda *_: {"id": 12345})

    def unexpected(*args, **kwargs):
        pytest.fail(
            "Identity enrichment requested Discogs details or full release scan"
        )

    monkeypatch.setattr(discogs, "get_artist", unexpected)
    monkeypatch.setattr(discogs, "enrich_artist", unexpected)
    result = _apply(
        _plan(enrichment_artist, providers=["discogs"], facets=["identity"])
    )
    assert result["execution"]["status"] == "completed"
    assert (
        read_enrichment_state(enrichment_artist["uid"])["artist"]["discogs_id"]
        == "12345"
    )


def test_lastfm_biography_does_not_fetch_similarities_or_full_artist_enrichment(
    enrichment_artist, monkeypatch
):
    import requests
    from crate import lastfm

    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    monkeypatch.setattr(lastfm, "get_cached_artist_info", lambda *_: None)
    monkeypatch.setattr(lastfm, "_lastfm_key", lambda: "test-key")
    requests_made = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"artist": {"bio": {"content": "Provider biography"}}}

    def get(url, **kwargs):
        requests_made.append((url, kwargs["params"]["method"]))
        return Response()

    def unexpected(*args, **kwargs):
        pytest.fail("Biography enrichment fetched extra Lastfm facets")

    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(lastfm, "_get_similar_artists", unexpected)
    monkeypatch.setattr(lastfm, "get_artist_info", unexpected)
    result = _apply(_plan(enrichment_artist, mode="refresh"))
    assert result["execution"]["status"] == "completed"
    assert requests_made == [("https://ws.audioscrobbler.com/2.0/", "artist.getinfo")]
    assert read_enrichment_state(enrichment_artist["uid"])["artist"]["bio"] == (
        "Provider biography"
    )


def test_maximum_batch_plan_remains_bounded_and_keeps_all_target_versions(monkeypatch):
    uids = [str(uuid4()) for _ in range(20)]
    monkeypatch.setattr(
        "crate.agent_enrichment.read_enrichment_state",
        lambda uid: {
            "artist": {"entity_uid": uid, "name": "Artist", "bio": "x" * 50000},
            "locks": [{"field_name": "bio"}, {"field_name": "genres"}],
            "genres": [],
            "setlists": None,
        },
    )
    plan = compile_operation(
        "enrichment",
        {
            "artist_uids": uids,
            "providers": ["lastfm", "spotify", "musicbrainz", "discogs", "setlist"],
            "facets": [
                "biography",
                "tags",
                "genres",
                "identity",
                "urls",
                "members",
                "popularity",
                "similar_artists",
                "setlists",
            ],
        },
        {},
    )
    assert set(plan["document"]["source_versions"]) == set(uids)
    assert len(plan["document"]["changes"]) == 20
    assert plan["document"]["impact"]["provider_fetches"] == 100
    assert len(json.dumps(plan["document"]).encode()) < 40000
    assert len(json.dumps(plan["execution"]).encode()) < 40000


@pytest.mark.parametrize("payload", [None, {}, []])
def test_empty_provider_result_is_reported_as_indeterminate_recoverable_partial(
    enrichment_artist, monkeypatch, payload
):
    monkeypatch.setattr("crate.agent_enrichment._fetch", lambda *_: payload)
    before = read_enrichment_state(enrichment_artist["uid"])
    result = _apply(_plan(enrichment_artist, mode="refresh"))
    provider = result["execution"]["items"][0]["providers"][0]
    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "partial"
    assert provider["status"] == "no_data"
    assert provider["code"] == "PROVIDER_EMPTY_OR_UNAVAILABLE"
    assert provider["recoverable"] is True
    assert read_enrichment_state(enrichment_artist["uid"]) == before


@pytest.mark.parametrize("provider,mode", [("fanart", "refresh"), ("lastfm", "reset")])
def test_repository_rejects_unknown_policy_without_a_transaction(
    provider, mode, monkeypatch
):
    def unexpected(*args, **kwargs):
        pytest.fail("Invalid policy opened a persistence scope")

    monkeypatch.setattr(
        "crate.db.repositories.agent_enrichment.optional_scope", unexpected
    )
    with pytest.raises(ValueError, match="policy"):
        apply_enrichment_result(
            str(uuid4()),
            expected_version="version",
            provider=provider,
            mode=mode,
            facets={},
            task_id="policy-rejection",
        )


def test_musicbrainz_members_preserve_provider_objects_for_shared_graph_readers(
    enrichment_artist, monkeypatch
):
    from crate import musicbrainz_ext
    from crate.db.queries.paths_artist_graph_queries import (
        load_artist_radio_graphs,
        load_shared_members_graph,
    )

    member = {
        "name": "Shared Member",
        "type": "member of band",
        "begin": "2000-03",
        "end": "",
        "attributes": ["guitar", "vocals"],
    }
    members = [member, {"name": "Open-ended Member", "end": None}]
    payload = {"members": members}
    # The real cached provider adapter returns these relation objects.
    monkeypatch.setattr(musicbrainz_ext, "get_cache", lambda *args, **kwargs: payload)
    monkeypatch.setattr(
        "crate.agent_enrichment.wait_for_provider_slot", lambda *_: None
    )
    with transaction_scope() as current:
        current.execute(
            text(
                "INSERT INTO library_artists(name,members_json) "
                "VALUES ('Second Band',CAST(:members AS jsonb))"
            ),
            {"members": json.dumps([member])},
        )

    result = _apply(
        _plan(enrichment_artist, providers=["musicbrainz"], facets=["members"])
    )

    assert result["execution"]["status"] == "completed", result
    assert result["verification"]["status"] == "passed", result
    assert (
        read_enrichment_state(enrichment_artist["uid"])["artist"]["members_json"]
        == members
    )
    assert load_shared_members_graph()["scoped artist"] == {"second band"}
    _, _, radio_graph = load_artist_radio_graphs()
    assert radio_graph["scoped artist"] == {"second band"}
    with read_scope() as current:
        audit = current.execute(
            text(
                "SELECT details_json FROM audit_log WHERE task_id='scoped-enrichment' "
                "AND action='scoped_artist_enrichment'"
            )
        ).scalar_one()
    assert audit["facets"][0]["after"] == {"members_json": members}


def test_musicbrainz_member_objects_are_bounded_without_inventing_metadata(
    enrichment_artist, monkeypatch
):
    members = [
        {
            "name": f"  Member {index} " + "x" * 300,
            "type": "member of band",
            "begin": "2000",
            "end": "",
            "attributes": [f"role {role} " + "x" * 300 for role in range(60)],
            "private_blob": "discarded",
        }
        for index in range(120)
    ]
    members[1] = {"name": "Name only"}
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch", lambda *_: {"members": members}
    )

    result = _apply(
        _plan(enrichment_artist, providers=["musicbrainz"], facets=["members"])
    )

    assert result["verification"]["status"] == "passed", result
    stored = read_enrichment_state(enrichment_artist["uid"])["artist"]["members_json"]
    assert len(stored) == 100
    assert stored[0] == {
        "name": members[0]["name"].strip()[:200],
        "type": "member of band",
        "begin": "2000",
        "end": "",
        "attributes": [value[:200] for value in members[0]["attributes"][:50]],
    }
    assert stored[1] == {"name": "Name only"}


@pytest.mark.parametrize(
    "members",
    [
        "Member",
        ["Member"],
        [{"type": "member of band"}],
        [{"name": "  "}],
        [{"name": 42}],
        [{"name": "Member", "type": {"unexpected": "object"}}],
        [{"name": "Member", "begin": ["2000"]}],
        [{"name": "Member", "attributes": "guitar"}],
        [{"name": "Member", "attributes": [None]}],
    ],
)
def test_malformed_musicbrainz_members_are_reported_without_replacing_metadata(
    enrichment_artist, monkeypatch, members
):
    from crate.db.queries.paths_artist_graph_queries import load_shared_members_graph

    existing = [{"name": "Reviewed Member", "attributes": ["bass"]}]
    with transaction_scope() as current:
        current.execute(
            text(
                "UPDATE library_artists SET members_json=CAST(:members AS jsonb) WHERE id=:id"
            ),
            {"members": json.dumps(existing), "id": enrichment_artist["id"]},
        )
    before = read_enrichment_state(enrichment_artist["uid"])
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch", lambda *_: {"members": members}
    )

    result = _apply(
        _plan(
            enrichment_artist,
            providers=["musicbrainz"],
            facets=["members"],
            mode="refresh",
        )
    )

    assert result["execution"]["status"] == "partial", result
    assert result["verification"]["status"] == "partial", result
    provider = result["execution"]["items"][0]["providers"][0]
    assert provider["status"] == "failed" and provider["recoverable"] is True
    assert read_enrichment_state(enrichment_artist["uid"]) == before
    assert load_shared_members_graph() == {}


@pytest.mark.parametrize("field_lock", [None, "members", "members_json"])
def test_musicbrainz_member_refresh_preserves_populated_or_locked_objects(
    enrichment_artist, monkeypatch, field_lock
):
    existing = [{"name": "Reviewed Member", "begin": "1999", "attributes": ["bass"]}]
    replacement = [{"name": "Provider Member", "type": "member of band", "end": "2005"}]
    with transaction_scope() as current:
        current.execute(
            text(
                "UPDATE library_artists SET members_json=CAST(:members AS jsonb) WHERE id=:id"
            ),
            {"members": json.dumps(existing), "id": enrichment_artist["id"]},
        )
        if field_lock:
            lock_fields(
                entity_type="artist",
                entity_id=enrichment_artist["id"],
                field_names=[field_lock],
                session=current,
            )
    monkeypatch.setattr(
        "crate.agent_enrichment._fetch", lambda *_: {"members": replacement}
    )

    result = _apply(
        _plan(
            enrichment_artist,
            providers=["musicbrainz"],
            facets=["members"],
            mode="refresh" if field_lock else "missing",
        )
    )

    assert result["verification"]["status"] == "passed", result
    assert (
        read_enrichment_state(enrichment_artist["uid"])["artist"]["members_json"]
        == existing
    )
    facets = result["execution"]["items"][0]["providers"][0]["facets"]
    assert facets[0]["status"] == ("locked" if field_lock else "present")
