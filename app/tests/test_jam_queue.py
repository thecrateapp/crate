"""Persistence contract for the authoritative Jam Session queue."""

from uuid import uuid4

from sqlalchemy import text

from crate.db.jam_queue import (
    add_jam_queue_item,
    advance_jam_queue,
    create_jam_track_request,
    list_jam_queue_items,
    list_jam_queue_vote_tracks,
    list_jam_track_requests,
    remove_jam_queue_item,
    reorder_jam_queue_item,
    resolve_jam_track_request,
    start_jam_queue,
    toggle_jam_queue_vote,
)
from crate.db.tx import transaction_scope


def _track(track_id: str) -> dict:
    return {"id": track_id, "title": track_id, "artist": "Test Artist"}


def _seed_library_track() -> dict:
    artist = f"Jam Artist {uuid4().hex}"
    album = f"Jam Album {uuid4().hex}"
    album_uid = uuid4()
    track_uid = uuid4()
    path = f"/music/{artist}/{album}/01-track.flac"
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name) VALUES (:artist)"),
            {"artist": artist},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (entity_uid, artist, name, path, has_cover)
                VALUES (:entity_uid, :artist, :name, :path, 1)
                RETURNING id
                """
            ),
            {
                "entity_uid": album_uid,
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
            },
        ).scalar_one()
        track_id = session.execute(
            text(
                """
                INSERT INTO library_tracks
                    (entity_uid, album_id, artist, album, filename, title, duration, path)
                VALUES (:entity_uid, :album_id, :artist, :album, :filename, :title, 120, :path)
                RETURNING id
                """
            ),
            {
                "entity_uid": track_uid,
                "album_id": album_id,
                "artist": artist,
                "album": album,
                "filename": "01-track.flac",
                "title": "Canonical Jam Track",
                "path": path,
            },
        ).scalar_one()
    return {
        "id": track_id,
        "entity_uid": str(track_uid),
        "album_id": album_id,
        "album_entity_uid": str(album_uid),
        "path": path,
    }


def test_manual_queue_has_stable_items_and_reorders_by_item_id(pg_db):
    host = pg_db.create_user("jam-queue-host@test.com")
    room = pg_db.create_jam_room(host["id"], "Queue Room")

    first = add_jam_queue_item(room["id"], _track("first"), host["id"], source="owner")
    second = add_jam_queue_item(
        room["id"], _track("second"), host["id"], source="owner"
    )

    assert [item["track"]["id"] for item in list_jam_queue_items(room["id"])] == [
        "first",
        "second",
    ]

    reorder_jam_queue_item(room["id"], second["id"], 0)

    queue = list_jam_queue_items(room["id"])
    assert [item["id"] for item in queue] == [second["id"], first["id"]]


def test_adding_the_same_track_to_a_room_queue_is_idempotent(pg_db):
    host = pg_db.create_user("jam-queue-dedupe-host@test.com")
    room = pg_db.create_jam_room(host["id"], "Queue Dedupe Room")

    first = add_jam_queue_item(room["id"], _track("same"), host["id"])
    duplicate = add_jam_queue_item(room["id"], _track("same"), host["id"])

    assert duplicate["id"] == first["id"]
    assert duplicate["_deduplicated"] is True
    assert [item["track"]["id"] for item in list_jam_queue_items(room["id"])] == [
        "same"
    ]


def test_queue_payload_is_canonicalized_for_artwork_and_playback(pg_db):
    host = pg_db.create_user("jam-queue-canonical-host@test.com")
    room = pg_db.create_jam_room(host["id"], "Queue Canonical Room")
    track = _seed_library_track()

    added = add_jam_queue_item(
        room["id"],
        {"id": str(track["id"]), "title": "Stale title", "artist": "Stale artist"},
        host["id"],
    )

    payload = added["track"]
    assert payload["libraryTrackId"] == track["id"]
    assert payload["entityUid"] == track["entity_uid"]
    assert payload["path"] == track["path"]
    assert payload["albumId"] == track["album_id"]
    assert payload["albumEntityUid"] == track["album_entity_uid"]
    assert payload["title"] == "Canonical Jam Track"

    listed = list_jam_queue_items(room["id"])
    assert listed[0]["track"]["albumEntityUid"] == track["album_entity_uid"]


def test_auto_queue_votes_change_order_and_accept_only_one_vote_per_member(pg_db):
    host = pg_db.create_user("jam-auto-host@test.com")
    guest = pg_db.create_user("jam-auto-guest@test.com")
    room = pg_db.create_jam_room(host["id"], "Auto Room", queue_mode="auto")
    pg_db.upsert_jam_room_member(room["id"], guest["id"], role="collab")

    add_jam_queue_item(room["id"], _track("first"), host["id"], source="owner")
    second = add_jam_queue_item(
        room["id"], _track("second"), guest["id"], source="member"
    )

    result = toggle_jam_queue_vote(room["id"], second["id"], guest["id"])
    assert result == {"voted": True, "vote_count": 1}
    assert (
        list_jam_queue_items(room["id"], user_id=guest["id"])[0]["id"] == second["id"]
    )

    result = toggle_jam_queue_vote(room["id"], second["id"], guest["id"])
    assert result == {"voted": False, "vote_count": 1}
    assert (
        list_jam_queue_items(room["id"], user_id=guest["id"])[0]["id"] == second["id"]
    )


def test_active_queue_vote_tracks_expose_bliss_vectors_and_vote_counts(pg_db):
    host = pg_db.create_user("jam-vote-target-host@test.com")
    guest = pg_db.create_user("jam-vote-target-guest@test.com")
    room = pg_db.create_jam_room(host["id"], "Vote Target Room", queue_mode="auto_dj")
    pg_db.upsert_jam_room_member(room["id"], guest["id"], role="collab")

    first = add_jam_queue_item(
        room["id"],
        {**_track("first"), "blissVector": [1.0, 0.0]},
        host["id"],
    )
    toggle_jam_queue_vote(room["id"], first["id"], guest["id"])

    assert list_jam_queue_vote_tracks(room["id"]) == [
        {"bliss_vector": [1.0, 0.0], "vote_count": 1}
    ]


def test_request_can_be_approved_into_queue(pg_db):
    host = pg_db.create_user("jam-request-host@test.com")
    guest = pg_db.create_user("jam-request-guest@test.com")
    room = pg_db.create_jam_room(host["id"], "Request Room")

    request = create_jam_track_request(room["id"], _track("requested"), guest["id"])
    assert list_jam_track_requests(room["id"])[0]["status"] == "pending"

    resolved = resolve_jam_track_request(
        room["id"], request["id"], host["id"], approve=True
    )

    assert resolved["status"] == "approved"
    assert resolved["queue_item_id"] is not None
    assert list_jam_queue_items(room["id"])[0]["track"]["id"] == "requested"

    assert (
        resolve_jam_track_request(room["id"], request["id"], host["id"], approve=True)
        is None
    )


def test_track_request_uses_canonical_payload_for_artwork_and_approval(pg_db):
    host = pg_db.create_user("jam-request-canonical-host@test.com")
    guest = pg_db.create_user("jam-request-canonical-guest@test.com")
    room = pg_db.create_jam_room(host["id"], "Canonical Request Room")
    track = _seed_library_track()

    request = create_jam_track_request(
        room["id"],
        {"id": str(track["id"]), "title": "Stale title"},
        guest["id"],
    )

    assert request["track"]["libraryTrackId"] == track["id"]
    assert request["track"]["albumEntityUid"] == track["album_entity_uid"]
    assert list_jam_track_requests(room["id"])[0]["track"]["path"] == track["path"]

    resolved = resolve_jam_track_request(
        room["id"], request["id"], host["id"], approve=True
    )

    assert resolved["track"]["libraryTrackId"] == track["id"]
    assert (
        list_jam_queue_items(room["id"])[0]["track"]["albumEntityUid"]
        == track["album_entity_uid"]
    )


def test_remove_queue_item_hides_it_from_authoritative_queue(pg_db):
    host = pg_db.create_user("jam-remove-host@test.com")
    room = pg_db.create_jam_room(host["id"], "Remove Room")
    first = add_jam_queue_item(room["id"], _track("first"), host["id"])
    second = add_jam_queue_item(room["id"], _track("second"), host["id"])

    assert remove_jam_queue_item(room["id"], first["id"])
    assert [item["id"] for item in list_jam_queue_items(room["id"])] == [second["id"]]
    assert not remove_jam_queue_item(room["id"], first["id"])


def test_advance_marks_current_item_played_and_selects_next(pg_db):
    host = pg_db.create_user("jam-advance-host@test.com")
    room = pg_db.create_jam_room(host["id"], "Advance Room")
    first = add_jam_queue_item(room["id"], _track("first"), host["id"])
    second = add_jam_queue_item(room["id"], _track("second"), host["id"])

    selected = advance_jam_queue(room["id"])
    assert selected is not None
    assert selected["id"] == first["id"]
    assert selected["status"] == "playing"

    selected = advance_jam_queue(room["id"])
    assert selected is not None
    assert selected["id"] == second["id"]
    assert list_jam_queue_items(room["id"])[0]["status"] == "playing"


def test_advance_reconciles_room_current_track_before_selecting_next(pg_db):
    host = pg_db.create_user("jam-advance-reconcile@test.com")
    room = pg_db.create_jam_room(host["id"], "Advance Reconcile Room")
    add_jam_queue_item(room["id"], _track("first"), host["id"])
    second = add_jam_queue_item(room["id"], _track("second"), host["id"])

    pg_db.update_jam_room_state(
        room["id"],
        current_track_payload={
            "track": _track("first"),
            "position": 42,
            "playing": True,
        },
    )

    selected = advance_jam_queue(room["id"])

    assert selected is not None
    assert selected["id"] == second["id"]
    queue = list_jam_queue_items(room["id"])
    assert [item["id"] for item in queue] == [second["id"]]
    assert queue[0]["status"] == "playing"


def test_start_keeps_current_item_and_selects_first_when_idle(pg_db):
    host = pg_db.create_user("jam-start-host@test.com")
    room = pg_db.create_jam_room(host["id"], "Start Room")
    first = add_jam_queue_item(room["id"], _track("first"), host["id"])
    second = add_jam_queue_item(room["id"], _track("second"), host["id"])

    selected = start_jam_queue(room["id"])
    assert selected is not None
    assert selected["id"] == first["id"]

    selected_again = start_jam_queue(room["id"])
    assert selected_again is not None
    assert selected_again["id"] == first["id"]
    assert [item["id"] for item in list_jam_queue_items(room["id"])] == [
        first["id"],
        second["id"],
    ]
