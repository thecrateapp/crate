"""Canonical event identity is shared by human, agent and provider writes."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

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
    ],
)
def test_closed_candidate_rejects_invented_or_invalid_values(changes):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        candidate(**changes)
