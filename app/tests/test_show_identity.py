"""Canonical event identity is shared by human, agent and provider writes."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError
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


def put(data, provider="manual", event_id=None):
    from crate.db.repositories.show_identities import upsert_canonical_show

    return upsert_canonical_show(
        data,
        {
            "provider": provider,
            "event_id": event_id,
            "actor": "user:1" if provider == "manual" else provider,
        },
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


@pytest.mark.parametrize("action", ["attend", "remind", "unattend"])
def test_relation_write_racing_consolidation_reaches_canonical_id(
    pg_db, monkeypatch, action
):
    from crate.db.repositories import shows_attendance as attendance
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.show_consolidation import consolidate_shows

    user = create_user("relation-race@example.test", role="user")
    canonical = put(candidate(local_time="18:00"))
    duplicate = put(candidate(local_time="21:00"))
    if action == "unattend":
        attendance.attend_show(user["id"], duplicate["show_id"])
    resolved, release = Event(), Event()
    original = attendance._canonical_id

    def pause_after_resolution(session, show_id):
        result = original(session, show_id)
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
        assert resolved.wait(timeout=5)
        merging = pool.submit(
            consolidate_shows,
            canonical["show_id"],
            [duplicate["show_id"]],
            {
                str(canonical["show_id"]): canonical["revision"],
                str(duplicate["show_id"]): duplicate["revision"],
            },
        )
        try:
            merging.result(timeout=0.3)
        except TimeoutError:
            pass  # Correct coordination waits until the relation write commits.
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
