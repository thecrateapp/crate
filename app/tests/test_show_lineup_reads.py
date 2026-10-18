"""Canonical and following views find every performer without widening filters."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from crate.db.queries.show_search import search_canonical_shows
from crate.db.repositories.show_identities import upsert_canonical_show
from crate.db.tx import read_scope, transaction_scope


def _today():
    return datetime.now(timezone.utc).date()


def _save_show(**changes):
    result = upsert_canonical_show(
        {
            "artist_name": "Primary Band",
            "lineup": ["Distinctive Support"],
            "date": (_today() + timedelta(days=30)).isoformat(),
            "venue": "Sala Norte",
            "city": "Madrid",
            **changes,
        },
        {"provider": "manual", "actor": "user:lineup-reader"},
    )
    assert result["status"] == "created", result
    return result["show_id"]


def _read_venues(view, artist_name):
    from crate.db.queries.shows_upcoming_queries import get_upcoming_shows
    from crate.db.queries.user import get_feed_shows
    from crate.db.queries.user import get_upcoming_shows as get_followed_shows

    if view == "artist":
        rows = get_upcoming_shows(artist_name=artist_name)
    elif view == "feed":
        return [
            row["title"] for row in get_feed_shows([artist_name], _today(), limit=20)
        ]
    else:
        rows = get_followed_shows(
            [artist_name], _today(), None, None, user_radius=60, limit=20
        )
    return [row["venue"] for row in rows]


@pytest.mark.parametrize("query", ["Distinctive Support", "sUpPoRt"])
def test_canonical_search_finds_a_support_act_in_the_lineup(pg_db, query):
    saved_id = _save_show()
    _save_show(venue="Sala Sur", lineup=["Unrelated Performer"])

    found = search_canonical_shows(query=query)

    assert [row["id"] for row in found["items"]] == [saved_id]


@pytest.mark.parametrize(
    ("query", "literal_name", "similar_name"),
    [
        ("%", "100% Noise", "100X Noise"),
        ("_", "Signal_Act", "SignalXAct"),
        ("!", "Shout! Act", "Shout Act"),
    ],
)
def test_canonical_lineup_search_treats_pattern_characters_literally(
    pg_db, query, literal_name, similar_name
):
    saved_id = _save_show(lineup=[literal_name])
    _save_show(venue="Sala Sur", lineup=[similar_name])

    found = search_canonical_shows(query=query)

    assert [row["id"] for row in found["items"]] == [saved_id]


def test_canonical_lineup_search_keeps_date_archive_and_consolidation_filters(pg_db):
    saved_id = _save_show()
    _save_show(venue="Past Venue", date=(_today() - timedelta(days=1)).isoformat())
    _save_show(venue="Later Venue", date=(_today() + timedelta(days=60)).isoformat())
    archived_id = _save_show(venue="Archived Venue")
    merged_id = _save_show(venue="Merged Venue")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE shows SET archived_at=NOW() WHERE id=:id"),
            {"id": archived_id},
        )
        session.execute(
            text("UPDATE shows SET merged_into_id=:canonical_id WHERE id=:id"),
            {"canonical_id": saved_id, "id": merged_id},
        )

    found = search_canonical_shows(
        query="Distinctive Support",
        date_from=_today(),
        date_to=_today() + timedelta(days=45),
    )

    assert [row["id"] for row in found["items"]] == [saved_id]


@pytest.mark.parametrize("performer_field", ["artist_name", "lineup"])
@pytest.mark.parametrize(
    "imported_name",
    [
        "Distinctive Support",
        "  DISTINCTIVE   support  ",
        "Distinctive\tSupport",
        "\t DISTINCTIVE \t support \n",
    ],
)
def test_canonical_artist_uid_search_normalizes_performer_names(
    pg_db, performer_field, imported_name
):
    pg_db.upsert_artist({"name": "Distinctive Support"})
    with read_scope() as session:
        artist_uid = session.execute(
            text(
                "SELECT entity_uid::text FROM library_artists WHERE name='Distinctive Support'"
            )
        ).scalar_one()
    changes = (
        {"artist_name": imported_name, "lineup": []}
        if performer_field == "artist_name"
        else {"lineup": [imported_name]}
    )
    saved_id = _save_show(**changes)

    found = search_canonical_shows(artist_uid=artist_uid)

    assert [row["id"] for row in found["items"]] == [saved_id]
    if performer_field == "artist_name":
        assert found["items"][0]["artist_uid"] == artist_uid


def test_canonical_artist_uid_search_keeps_exact_names_and_visibility_filters(pg_db):
    pg_db.upsert_artist({"name": "Distinctive Support"})
    with read_scope() as session:
        artist_uid = session.execute(
            text(
                "SELECT entity_uid::text FROM library_artists WHERE name='Distinctive Support'"
            )
        ).scalar_one()
    saved_id = _save_show(lineup=["Distinctive\tSupport"])
    _save_show(venue="Unrelated Venue", lineup=["Distinctive Support Ensemble"])
    _save_show(venue="Past Venue", date=(_today() - timedelta(days=1)).isoformat())
    _save_show(venue="Later Venue", date=(_today() + timedelta(days=60)).isoformat())
    archived_id = _save_show(venue="Archived Venue")
    merged_id = _save_show(venue="Merged Venue")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE shows SET archived_at=NOW() WHERE id=:id"),
            {"id": archived_id},
        )
        session.execute(
            text("UPDATE shows SET merged_into_id=:canonical_id WHERE id=:id"),
            {"canonical_id": saved_id, "id": merged_id},
        )

    found = search_canonical_shows(
        artist_uid=artist_uid,
        date_from=_today(),
        date_to=_today() + timedelta(days=45),
    )

    assert [row["id"] for row in found["items"]] == [saved_id]


def test_canonical_artist_search_leaves_ambiguous_normalized_primary_uid_empty(pg_db):
    pg_db.upsert_artist({"name": "Distinctive Support"})
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO library_artists(name,entity_uid)
                VALUES('Distinctive  Support',gen_random_uuid())""")
        )
    saved_id = _save_show(artist_name="Distinctive Support", lineup=[])

    found = search_canonical_shows(show_id=saved_id)

    assert [row["id"] for row in found["items"]] == [saved_id]
    assert found["items"][0]["artist_uid"] is None


@pytest.mark.parametrize("performer_field", ["artist_name", "lineup"])
@pytest.mark.parametrize(
    "imported_name", ["Distinctive Support", "\t DISTINCTIVE \t support \n"]
)
def test_show_write_invalidates_library_artists_with_normalized_performer_names(
    pg_db, performer_field, imported_name
):
    pg_db.upsert_artist({"name": "Distinctive Support"})
    changes = (
        {"artist_name": imported_name, "lineup": []}
        if performer_field == "artist_name"
        else {"lineup": [imported_name]}
    )

    _save_show(**changes)

    with read_scope() as session:
        scopes = (
            session.execute(
                text("""SELECT payload_json->>'scope' FROM domain_event_outbox
                WHERE event_type='ui.invalidate' AND payload_json->>'source'='show_write'""")
            )
            .scalars()
            .all()
        )
    assert "artist:Distinctive Support" in scopes


@pytest.mark.parametrize("view", ["artist", "feed", "following"])
@pytest.mark.parametrize(
    "imported_name", ["distinctive support", "  DISTINCTIVE   support  "]
)
def test_manual_lineup_resolves_a_library_artist_in_following_views(
    pg_db, view, imported_name
):
    from crate.db.repositories.show_import_selection import compile_show_import

    pg_db.upsert_artist({"name": "Distinctive Support"})
    source = {"provider": "manual", "actor": "user:lineup-reader"}
    planned = compile_show_import(
        [
            {
                "item_id": "support-case",
                "artist_name": "Primary Band",
                "lineup": [imported_name],
                "date": (_today() + timedelta(days=30)).isoformat(),
                "venue": "Sala Norte",
                "city": "Madrid",
            }
        ],
        source,
    )
    assert planned["executable"] is True, planned
    saved = upsert_canonical_show(planned["items"][0]["candidate"], source)
    assert saved["status"] == "created", saved

    assert _read_venues(view, "Distinctive Support") == ["Sala Norte"]


@pytest.mark.parametrize("view", ["artist", "feed", "following"])
def test_lineup_following_keeps_date_consolidation_and_exact_name_filters(pg_db, view):
    saved_id = _save_show()
    _save_show(venue="Past Venue", date=(_today() - timedelta(days=1)).isoformat())
    _save_show(venue="Other Venue", lineup=["Distinctive Support Ensemble"])
    merged_id = _save_show(venue="Merged Venue")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE shows SET merged_into_id=:canonical_id WHERE id=:id"),
            {"canonical_id": saved_id, "id": merged_id},
        )
    if view != "feed":
        _save_show(venue="Cancelled Venue", status="cancelled")

    assert _read_venues(view, "Distinctive Support") == ["Sala Norte"]


@pytest.mark.parametrize("view", ["artist", "feed", "following"])
@pytest.mark.parametrize("performer_field", ["artist_name", "lineup"])
def test_legacy_performers_with_outer_tabs_match_followed_artist(
    pg_db, view, performer_field
):
    saved_id = _save_show()
    # Legacy/provider rows can predate the manual importer's whitespace cleanup.
    with transaction_scope() as session:
        if performer_field == "artist_name":
            statement = "UPDATE shows SET artist_name=:name, lineup=ARRAY[]::text[] WHERE id=:id"
        else:
            statement = (
                "UPDATE shows SET lineup=ARRAY[CAST(:name AS text)] WHERE id=:id"
            )
        session.execute(
            text(statement),
            {"id": saved_id, "name": "\t DISTINCTIVE \t support \n"},
        )

    assert _read_venues(view, " \t Distinctive support\n") == ["Sala Norte"]
