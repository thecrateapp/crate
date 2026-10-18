"""Canonical event identity is shared by human, agent and provider writes."""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Barrier, Event

import pytest
from sqlalchemy import text

from crate.db.tx import read_scope


def candidate(**changes):
    from crate.api.schemas.show_imports import ShowCandidate

    return ShowCandidate.model_validate(
        {
            "item_id": "date-1",
            "artist_name": "Primary Band",
            "date": "2027-03-02",
            "venue": "Sala Norte",
            "city": "Madrid",
            "country_code": "ES",
            **changes,
        }
    ).model_dump(mode="json", exclude_unset=True)


def put(data, provider="manual", event_id=None, *, session=None):
    from crate.db.repositories.show_identities import upsert_canonical_show

    return upsert_canonical_show(
        data,
        {
            "provider": provider,
            "event_id": event_id,
            "actor": "user:1" if provider == "manual" else provider,
        },
        session=session,
    )


def row(show_id):
    with read_scope() as session:
        return dict(
            session.execute(text("SELECT * FROM shows WHERE id=:id"), {"id": show_id})
            .mappings()
            .one()
        )


@pytest.mark.parametrize("first", ["manual", "ticketmaster"])
def test_manual_and_provider_share_identity_and_preserve_manual_fields(pg_db, first):
    manual = candidate(
        local_time="20:00",
        tickets_url="https://venue.example/manual",
        lineup=["Support"],
    )
    provider = candidate(
        local_time="20:00",
        tickets_url="https://tickets.example/provider",
        lineup=["New Support"],
    )
    if first == "manual":
        initial = put(manual)
        linked = put(provider, "ticketmaster", "tm-1")
    else:
        initial = put(provider, "ticketmaster", "tm-1")
        linked = put(manual)
    assert linked["show_id"] == initial["show_id"]
    put(
        candidate(local_time="21:00", tickets_url=None, lineup=["Another Support"]),
        "ticketmaster",
        "tm-1",
    )
    actual = row(initial["show_id"])
    assert actual["local_time"] == "20:00"
    assert actual["tickets_url"] == "https://venue.example/manual"
    assert {"Support", "Primary Band"} <= set(actual["lineup"])
    assert actual["field_provenance"]["local_time"]["provider"] == "manual"


@pytest.mark.parametrize("first", ["manual", "ticketmaster"])
def test_inverted_primary_artists_share_the_same_complete_lineup_identity(pg_db, first):
    manual = candidate(
        artist_name="Support", lineup=["Primary Band"], local_time="20:00"
    )
    provider = candidate(lineup=["Support"], local_time="20:00")
    if first == "manual":
        initial = put(manual)
        linked = put(provider, "ticketmaster", "inverted-lineup")
    else:
        initial = put(provider, "ticketmaster", "inverted-lineup")
        linked = put(manual)
    assert linked["show_id"] == initial["show_id"]
    assert row(initial["show_id"])["artist_name"] == (
        "Support" if first == "manual" else "Primary Band"
    )
    assert set(row(initial["show_id"])["lineup"]) == {"Support", "Primary Band"}
    with read_scope() as session:
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 1
        assert (
            session.execute(
                text(
                    "SELECT show_id FROM show_source_aliases WHERE event_id='inverted-lineup'"
                )
            ).scalar_one()
            == initial["show_id"]
        )


@pytest.mark.parametrize("lookup", ["single", "batch", "locked_batch"])
def test_lineup_identity_preview_normalizes_every_artist_and_does_not_write(
    pg_db, lookup
):
    from crate.db.repositories.show_identities import (
        match_show_candidates,
        preview_show,
    )
    from crate.db.tx import transaction_scope

    saved = put(candidate(lineup=["Support"], local_time="20:00"))
    selected = candidate(
        artist_name="SUPPORT",
        lineup=["primary   band", "support"],
        local_time="20:00",
    )
    if lookup == "single":
        matched = preview_show(selected, {"provider": "manual"})
    elif lookup == "locked_batch":
        with transaction_scope() as session:
            matched = match_show_candidates([selected], lock=True, session=session)[
                "date-1"
            ]
    else:
        matched = match_show_candidates([selected])["date-1"]
    assert matched["status"] == "already_exists"
    assert matched["show"]["id"] == saved["show_id"]
    assert row(saved["show_id"])["revision"] == saved["revision"]


@pytest.mark.parametrize("lookup", ["single", "batch", "locked_batch"])
@pytest.mark.parametrize("performer_field", ["artist_name", "lineup"])
def test_identity_matching_normalizes_legacy_performers_with_outer_tabs(
    pg_db, lookup, performer_field
):
    from crate.db.repositories.show_identities import (
        match_show_candidates,
        preview_show,
    )
    from crate.db.tx import transaction_scope

    saved = put(candidate())
    with transaction_scope() as session:
        statement = (
            "UPDATE shows SET artist_name=:name, lineup=ARRAY[]::text[] WHERE id=:id"
            if performer_field == "artist_name"
            else "UPDATE shows SET artist_name='Other Band', lineup=ARRAY[CAST(:name AS text)] WHERE id=:id"
        )
        session.execute(
            text(statement),
            {"id": saved["show_id"], "name": "\t PRIMARY \t Band \n"},
        )
    selected = candidate(lineup=[])

    if lookup == "single":
        matched = preview_show(selected, {"provider": "manual"})
    elif lookup == "locked_batch":
        with transaction_scope() as session:
            matched = match_show_candidates([selected], lock=True, session=session)[
                "date-1"
            ]
    else:
        matched = match_show_candidates([selected])["date-1"]

    if performer_field == "lineup":
        assert matched["status"] == "conflict"
        assert matched["matches"] == [saved["show_id"]]
    else:
        assert matched["status"] == "already_exists"
        assert matched["show"]["id"] == saved["show_id"]


@pytest.mark.parametrize(
    "changes",
    [
        {"local_time": "21:00"},
        {"venue": "Palacio Sur"},
        {"country_code": "FR"},
        {"city": "Barcelona"},
        {"date": "2027-03-03"},
    ],
)
def test_identical_lineups_keep_distinct_sessions_and_locations(pg_db, changes):
    from crate.db.repositories.show_identities import match_show_candidates

    saved = put(candidate(lineup=["Support"], local_time="20:00"))
    selected = candidate(
        artist_name="Support",
        lineup=["Primary Band"],
        **{"local_time": "20:00", **changes},
    )
    assert match_show_candidates([selected])["date-1"]["status"] == "created"
    other = put(selected, "ticketmaster", "separate-lineup")
    assert other["status"] == "created"
    assert other["show_id"] != saved["show_id"]


def test_inverted_lineup_with_unknown_time_requires_choosing_a_session(pg_db):
    from crate.db.repositories.show_identities import match_show_candidates

    first = put(candidate(lineup=["Support"], local_time="18:00"))
    second = put(candidate(lineup=["Support"], local_time="21:00"))
    selected = candidate(artist_name="Support", lineup=["Primary Band"])
    preview = match_show_candidates([selected])["date-1"]
    assert preview["status"] == "conflict"
    assert set(preview["matches"]) == {first["show_id"], second["show_id"]}
    assert put(selected, "ticketmaster", "unknown-session")["status"] == "conflict"


@pytest.mark.parametrize(
    "changes",
    [
        {"artist_name": "Support", "lineup": []},
        {"artist_name": "Other Band", "lineup": ["Support"]},
        {"artist_name": "Support", "lineup": ["Primary Band", "Another Band"]},
    ],
)
def test_partial_lineup_overlap_requires_review_instead_of_merging(pg_db, changes):
    from crate.db.repositories.show_identities import (
        match_show_candidates,
        preview_show,
    )

    saved = put(candidate(lineup=["Support"], local_time="20:00"))
    selected = candidate(local_time="20:00", **changes)
    for matched in (
        preview_show(selected, {"provider": "manual"}),
        match_show_candidates([selected])["date-1"],
        put(selected, "ticketmaster", "partial-lineup"),
    ):
        assert matched["status"] == "conflict"
        assert matched["matches"] == [saved["show_id"]]
    assert row(saved["show_id"])["lineup"] == ["Primary Band", "Support"]
    with read_scope() as session:
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 1
        assert (
            session.execute(
                text("SELECT count(*) FROM show_source_aliases")
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize("complete", [True, False])
def test_concurrent_inverted_headliners_serialize_before_matching(
    pg_db, monkeypatch, complete
):
    from crate.db.repositories import show_identities as identities
    from tests.test_agent_library_operations import (
        _assert_backend_waits_for,
        _with_backend_pid,
    )

    manual_matching, release_manual = Event(), Event()
    manual_pids, provider_pids = Queue(), Queue()
    original = identities._match

    def paused_match(current, selected, source):
        if source["provider"] == "manual":
            manual_matching.set()
            assert release_manual.wait(timeout=10)
        return original(current, selected, source)

    monkeypatch.setattr(identities, "_match", paused_match)

    with ThreadPoolExecutor(max_workers=2) as pool:
        manual = pool.submit(
            _with_backend_pid,
            manual_pids,
            put,
            candidate(lineup=["Support"], local_time="20:00"),
        )
        assert manual_matching.wait(timeout=5)
        provider = pool.submit(
            _with_backend_pid,
            provider_pids,
            put,
            candidate(
                artist_name="Support",
                lineup=["Primary Band"] if complete else [],
                local_time="20:00",
            ),
            "ticketmaster",
            "concurrent-inverted",
        )
        try:
            _assert_backend_waits_for(
                provider, provider_pids.get(timeout=5), manual_pids.get(timeout=5)
            )
        finally:
            release_manual.set()
        first, second = manual.result(timeout=10), provider.result(timeout=10)
    if complete:
        assert second["show_id"] == first["show_id"]
    else:
        assert second["status"] == "conflict"
        assert second["matches"] == [first["show_id"]]
    with read_scope() as session:
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 1


def test_selection_rejects_new_rows_for_the_same_inverted_lineup(pg_db):
    from crate.db.repositories.show_import_selection import compile_show_import

    prepared = compile_show_import(
        [
            candidate(item_id="primary", lineup=["Support"], local_time="20:00"),
            candidate(
                item_id="support",
                artist_name="Support",
                lineup=["Primary Band"],
                local_time="20:00",
            ),
        ],
        {"provider": "manual", "actor": "user:1"},
    )
    assert prepared["executable"] is False
    assert {issue["item_id"] for issue in prepared["issues"]} == {"primary", "support"}
    assert {issue["status"] for issue in prepared["issues"]} == {"conflict"}
    with read_scope() as session:
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 0


def test_distinct_sessions_and_ambiguous_unknown_time_are_not_silently_merged(pg_db):
    first = put(candidate(local_time="18:00"))
    second = put(candidate(local_time="21:00"))
    assert first["show_id"] != second["show_id"]
    ambiguous = put(candidate(), "setlistfm", "sf-1")
    assert ambiguous["status"] == "conflict"
    assert set(ambiguous["matches"]) == {first["show_id"], second["show_id"]}


def test_same_day_different_venue_is_another_show_but_missing_venue_is_conflict(pg_db):
    first = put(candidate())
    second = put(candidate(venue="Palacio Sur"))
    assert first["show_id"] != second["show_id"]
    assert put(candidate(venue=None), "ticketmaster", "weak-1")["status"] == "conflict"


def test_concurrent_manual_and_provider_insert_one_canonical_row(pg_db):
    barrier = Barrier(2)

    def write(provider):
        barrier.wait(timeout=5)
        return put(
            candidate(local_time="20:00"),
            provider,
            "race-1" if provider == "ticketmaster" else None,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ["manual", "ticketmaster"]))
    assert len({result["show_id"] for result in results}) == 1
    with read_scope() as session:
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 1


def test_provider_alias_preserves_primary_artist_and_accumulates_lineup(pg_db):
    first = put(candidate(lineup=["Support"]), "ticketmaster", "festival-1")
    later = put(
        candidate(artist_name="Support", lineup=["Primary Band"]),
        "ticketmaster",
        "festival-1",
    )
    assert later["show_id"] == first["show_id"]
    assert row(first["show_id"])["artist_name"] == "Primary Band"


def test_same_named_venue_and_city_in_different_countries_are_distinct(pg_db):
    first = put(candidate(city="Paris", country_code="FR"))
    other = put(candidate(city="Paris", country_code="US"))
    assert other["show_id"] != first["show_id"]


def test_preview_has_no_effect_and_manual_corrections_use_exact_revision(pg_db):
    from crate.db.repositories.show_identities import preview_show

    assert preview_show(candidate(), {"provider": "manual"})["status"] == "created"
    with read_scope() as session:
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 0
    first = put(candidate(local_time="20:00"))
    corrected = put(
        candidate(
            existing_show_id=first["show_id"],
            expected_revision=first["revision"],
            local_time=None,
        )
    )
    assert corrected["show_id"] == first["show_id"]
    assert row(first["show_id"])["local_time"] is None
    assert (
        put(
            candidate(
                existing_show_id=first["show_id"], expected_revision=first["revision"]
            )
        )["status"]
        == "conflict"
    )


def test_retention_archives_without_erasing_alias_identity(pg_db):
    from crate.db.repositories.shows_maintenance import delete_past_shows

    original = put(candidate(date="2020-03-02"), "ticketmaster", "past-1")
    delete_past_shows(days_old=30)
    replay = put(candidate(date="2020-03-02"), "ticketmaster", "past-1")
    assert replay["show_id"] == original["show_id"]
    assert row(original["show_id"])["archived_at"] is not None


def test_legacy_provider_writer_and_lineup_reader_use_the_canonical_show(pg_db):
    from crate.db.repositories.shows_ticketmaster_upserts import upsert_show
    from crate.db.queries.shows_upcoming_queries import get_upcoming_shows

    original = put(candidate(lineup=["Support"]))
    provider_id = upsert_show(
        "legacy-1",
        "Primary Band",
        "2027-03-02",
        venue="Sala Norte",
        city="Madrid",
        country_code="ES",
        lineup=["New Support"],
    )
    assert provider_id == original["show_id"]
    assert get_upcoming_shows(artist_name="Support")[0]["id"] == provider_id
    from datetime import date
    from crate.db.queries.user import get_feed_shows

    assert len(get_feed_shows(["Support"], date(2027, 1, 1), 20)) == 1


def test_canonical_ids_are_not_silently_deduplicated_in_the_read_plane():
    from crate.db.queries.shows_shared import dedupe_show_rows

    first = {
        "id": 1,
        "artist_name": "Band",
        "date": "2027-03-02",
        "venue": "Venue",
        "city": "City",
    }
    assert len(dedupe_show_rows([first, {**first, "id": 2}])) == 2


def test_explicit_consolidation_transfers_relations_and_keeps_redirect_identity(pg_db):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.show_identities import consolidate_shows
    from crate.db.repositories.shows_attendance import attend_show, create_show_reminder
    from crate.db.tx import transaction_scope

    user = create_user("curator@example.test", role="curator")
    first = put(candidate(), "ticketmaster", "tm-consolidate")
    with transaction_scope() as session:
        duplicate = session.execute(
            text("""INSERT INTO shows(external_id,artist_name,date,venue,city,created_at,updated_at)
            VALUES ('sf-duplicate','Primary Band','2027-03-02','Sala Norte','Madrid',NOW(),NOW()) RETURNING id""")
        ).scalar_one()
    attend_show(user["id"], first["show_id"])
    attend_show(user["id"], duplicate)
    create_show_reminder(user["id"], duplicate, "day_before")
    result = consolidate_shows(
        first["show_id"],
        [duplicate],
        {
            str(first["show_id"]): row(first["show_id"])["revision"],
            str(duplicate): row(duplicate)["revision"],
        },
    )
    assert result["show_id"] == first["show_id"]
    assert row(duplicate)["merged_into_id"] == first["show_id"]
    attend_show(user["id"], duplicate)
    create_show_reminder(user["id"], duplicate, "day_before")
    with read_scope() as session:
        assert session.execute(
            text("SELECT show_id FROM user_show_attendance")
        ).scalars().all() == [first["show_id"]]
        assert (
            session.execute(
                text("SELECT show_id FROM user_show_reminders")
            ).scalar_one()
            == first["show_id"]
        )
    from crate.db.queries.shows_upcoming_queries import (
        get_all_shows,
        get_upcoming_show_counts,
    )

    assert [show["id"] for show in get_all_shows()] == [first["show_id"]]
    assert get_upcoming_show_counts()["show_count"] == 1
    from crate.db.repositories.shows_attendance import unattend_show

    assert unattend_show(user["id"], duplicate) is True
    assert (
        consolidate_shows(
            first["show_id"], [duplicate], {str(first["show_id"]): 1, str(duplicate): 1}
        )["status"]
        == "conflict"
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"date": "March 2"},
        {"local_time": "25:60"},
        {"timezone": "Europe/Nowhere"},
        {"latitude": 91},
        {"longitude": -181},
        {"doors_time": "8pm"},
        {"extra": True},
        {"artist_uid": "-" * 36},
    ],
)
def test_closed_candidate_rejects_invented_or_invalid_values(changes):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        candidate(**changes)


def test_country_names_without_codes_do_not_merge_different_countries(pg_db):
    first = put(candidate(country_code=None, country="France", city="Saint-Denis"))
    second = put(candidate(country_code=None, country="Reunion", city="Saint-Denis"))
    assert first["show_id"] != second["show_id"]


def test_explicit_lineup_correction_removes_wrong_support_and_survives_sync(pg_db):
    first = put(candidate(lineup=["Wrong support"]))
    corrected = put(
        candidate(
            existing_show_id=first["show_id"],
            expected_revision=first["revision"],
            lineup=["Right support"],
        )
    )
    assert row(first["show_id"])["lineup"] == ["Primary Band", "Right support"]
    put(candidate(lineup=["Wrong support"]), "ticketmaster", "lineup-source")
    assert row(corrected["show_id"])["lineup"] == ["Primary Band", "Right support"]


def test_repeated_consolidations_flatten_old_id_redirects(pg_db):
    from crate.db.repositories.show_consolidation import consolidate_shows

    first = put(candidate(local_time="18:00"))
    second = put(candidate(local_time="19:00"))
    third = put(candidate(local_time="20:00"))
    merged = consolidate_shows(
        first["show_id"],
        [second["show_id"]],
        {
            str(first["show_id"]): first["revision"],
            str(second["show_id"]): second["revision"],
        },
    )
    consolidate_shows(
        third["show_id"],
        [first["show_id"]],
        {
            str(third["show_id"]): third["revision"],
            str(first["show_id"]): merged["revision"],
        },
    )
    assert row(second["show_id"])["merged_into_id"] == third["show_id"]


def test_shared_show_readers_never_expose_private_field_evidence(pg_db):
    from crate.db.queries.shows_upcoming_queries import (
        get_upcoming_shows,
        get_all_shows,
    )

    put(candidate(evidence="PRIVATE FLYER TEXT", source_ref="private-upload:opaque"))
    for read in (get_upcoming_shows, get_all_shows):
        shows = read()
        assert shows and "field_provenance" not in shows[0]
        assert "PRIVATE FLYER TEXT" not in str(shows)


def test_provider_reschedule_unarchives_an_expired_identity(pg_db):
    from crate.db.tx import transaction_scope

    original = put(candidate(date="2020-03-02"), "ticketmaster", "rescheduled")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE shows SET archived_at=NOW() WHERE id=:id"),
            {"id": original["show_id"]},
        )
    changed = put(
        candidate(date="2027-03-02", status="rescheduled"),
        "ticketmaster",
        "rescheduled",
    )
    assert changed["show_id"] == original["show_id"]
    assert row(changed["show_id"])["archived_at"] is None


@pytest.mark.parametrize(
    "value",
    [
        "http://#",
        "https://user:secret@example.test/tickets",
        "http://example.test:invalid/path",
    ],
)
def test_show_urls_require_a_real_host_and_no_embedded_credentials(value):
    from crate.api.schemas.show_imports import ShowCandidate

    with pytest.raises(ValueError):
        ShowCandidate(item_id="one", url=value)


def test_provider_rechecks_a_row_consolidated_between_match_and_lock(
    pg_db, monkeypatch
):
    from crate.db.repositories import show_identities as identities
    from crate.db.repositories.show_consolidation import consolidate_shows

    first = put(candidate(local_time="18:00"), "ticketmaster", "first-source")
    second = put(candidate(local_time="21:00"), "ticketmaster", "second-source")
    real = identities._match

    def stale_match(current, selected, source):
        matched = real(current, selected, source)
        consolidate_shows(
            first["show_id"],
            [second["show_id"]],
            {
                str(first["show_id"]): first["revision"],
                str(second["show_id"]): second["revision"],
            },
        )
        return matched

    monkeypatch.setattr(identities, "_match", stale_match)
    result = put(candidate(local_time="21:00"), "ticketmaster", "second-source")
    assert result["status"] == "conflict"
    assert row(second["show_id"])["identity_key"] is None
    assert row(second["show_id"])["merged_into_id"] == first["show_id"]


def test_provider_rechecks_semantic_match_after_manual_identity_correction(
    pg_db, monkeypatch
):
    from crate.db.repositories import show_identities as identities

    original = candidate(lineup=["Primary Band"])
    saved = put(original)
    matched, resume = Event(), Event()
    real_match = identities._match

    def pause_provider_match(current, selected, source):
        result = real_match(current, selected, source)
        if source["provider"] == "ticketmaster":
            assert result["show"]["id"] == saved["show_id"]
            matched.set()
            assert resume.wait(timeout=10)
        return result

    monkeypatch.setattr(identities, "_match", pause_provider_match)
    provider = {
        "provider": "ticketmaster",
        "actor": "ticketmaster",
        "event_id": "new-provider-event",
    }
    with ThreadPoolExecutor(max_workers=1) as pool:
        waiting = pool.submit(identities.upsert_canonical_show, original, provider)
        try:
            assert matched.wait(timeout=5)
            corrected = put(
                candidate(
                    existing_show_id=saved["show_id"],
                    expected_revision=saved["revision"],
                    artist_name="Other Band",
                    lineup=["Other Band"],
                    date="2027-03-07",
                    venue="Other Venue",
                    city="Other City",
                )
            )
            assert corrected["show_id"] == saved["show_id"]
            with read_scope() as session:
                assert real_match(session, original, provider)["status"] == "created"
        finally:
            resume.set()
        result = waiting.result(timeout=10)

    assert result["status"] == "conflict" or result["show_id"] != saved["show_id"], (
        result
    )
    actual = row(saved["show_id"])
    assert actual["artist_name"] == "Other Band"
    assert actual["lineup"] == ["Other Band"]
    assert str(actual["date"]) == "2027-03-07"
    assert actual["venue"] == "Other Venue"
    with read_scope() as session:
        aliases = (
            session.execute(
                text(
                    "SELECT show_id FROM show_source_aliases WHERE event_id='new-provider-event'"
                )
            )
            .scalars()
            .all()
        )
    assert saved["show_id"] not in aliases


def test_fresh_provider_does_not_match_a_manually_corrected_identity(pg_db):
    original = candidate(lineup=["Primary Band"])
    saved = put(original)
    corrected = put(
        candidate(
            existing_show_id=saved["show_id"],
            expected_revision=saved["revision"],
            artist_name="Other Band",
            lineup=["Other Band"],
            date="2027-03-07",
            venue="Other Venue",
            city="Other City",
        )
    )

    fresh = put(original, "ticketmaster", "fresh-provider-event")

    assert corrected["show_id"] == saved["show_id"]
    assert fresh["status"] == "created"
    assert fresh["show_id"] != saved["show_id"]


@pytest.mark.parametrize("action", ["attend", "remind", "unattend"])
def test_relation_write_racing_consolidation_reaches_canonical_id(
    pg_db, monkeypatch, action
):
    from tests.test_agent_library_operations import (
        _assert_backend_waits_for,
        _with_backend_pid,
    )

    from crate.db.repositories import shows_attendance as attendance
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.show_consolidation import consolidate_shows

    user = create_user("relation-race@example.test", role="user")
    canonical = put(candidate(local_time="18:00"))
    duplicate = put(candidate(local_time="21:00"))
    if action == "unattend":
        attendance.attend_show(user["id"], duplicate["show_id"])
    resolved, release = Event(), Event()
    writing_pids, merging_pids = Queue(), Queue()
    original = attendance._canonical_id

    def pause_after_resolution(session, show_id):
        result = original(session, show_id)
        writing_pids.put(session.execute(text("SELECT pg_backend_pid()")).scalar_one())
        resolved.set()
        assert release.wait(timeout=10)
        return result

    monkeypatch.setattr(attendance, "_canonical_id", pause_after_resolution)

    def write():
        if action == "remind":
            return attendance.create_show_reminder(
                user["id"], duplicate["show_id"], "day_before"
            )
        function = (
            attendance.unattend_show if action == "unattend" else attendance.attend_show
        )
        return function(user["id"], duplicate["show_id"])

    with ThreadPoolExecutor(max_workers=2) as pool:
        writing = pool.submit(write)
        try:
            assert resolved.wait(timeout=5)
            merging = pool.submit(
                _with_backend_pid,
                merging_pids,
                consolidate_shows,
                canonical["show_id"],
                [duplicate["show_id"]],
                {
                    str(canonical["show_id"]): canonical["revision"],
                    str(duplicate["show_id"]): duplicate["revision"],
                },
            )
            _assert_backend_waits_for(
                merging,
                merging_pids.get(timeout=5),
                writing_pids.get(timeout=5),
            )
        finally:
            release.set()
        assert writing.result(timeout=10) is True
        assert merging.result(timeout=10)["status"] == "completed"
    table = "user_show_reminders" if action == "remind" else "user_show_attendance"
    with read_scope() as session:
        actual = session.execute(text(f"SELECT show_id FROM {table}")).scalars().all()
    assert actual == ([] if action == "unattend" else [canonical["show_id"]])


def test_provider_sync_after_consolidating_into_manual_canonical(pg_db):
    from crate.db.repositories.show_consolidation import consolidate_shows

    canonical = put(candidate(local_time="18:00"))
    duplicate = put(candidate(local_time="21:00"), "ticketmaster", "merged-provider")
    consolidate_shows(
        canonical["show_id"],
        [duplicate["show_id"]],
        {
            str(canonical["show_id"]): canonical["revision"],
            str(duplicate["show_id"]): duplicate["revision"],
        },
    )
    result = put(candidate(local_time="21:00"), "ticketmaster", "merged-provider")
    assert result["show_id"] == canonical["show_id"]
    assert row(canonical["show_id"])["local_time"] == "18:00"
    with read_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT show_id FROM show_source_aliases WHERE event_id='merged-provider'"
                )
            ).scalar_one()
            == canonical["show_id"]
        )


@pytest.mark.parametrize("provider", ["setlistfm", "lastfm"])
def test_structured_provider_reference_matches_legacy_prefixed_alias(pg_db, provider):
    first = put(candidate(), provider, provider + ":legacy-event")
    edited = put(
        candidate(
            date="2027-03-03", source_provider=provider, source_event_id="legacy-event"
        )
    )
    assert edited["show_id"] == first["show_id"]
    synced = put(candidate(date="2027-03-04"), provider, provider + ":legacy-event")
    assert synced["show_id"] == first["show_id"]
    assert str(row(first["show_id"])["date"]) == "2027-03-03"


@pytest.mark.parametrize("action", ["attend", "remind", "unattend"])
def test_missing_show_relation_operations_are_idempotent(pg_db, action):
    from crate.db.repositories import shows_attendance as attendance
    from crate.db.repositories.auth_user_accounts import create_user

    user = create_user("missing-show@example.test", role="user")
    if action == "remind":
        result = attendance.create_show_reminder(user["id"], 2147483647, "day_before")
    else:
        function = (
            attendance.attend_show if action == "attend" else attendance.unattend_show
        )
        result = function(user["id"], 2147483647)
    assert result is False
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM user_show_attendance")
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM user_show_reminders")
            ).scalar_one()
            == 0
        )
