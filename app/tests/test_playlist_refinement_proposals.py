import pytest

from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.repositories.playlists_mutate import update_playlist
from crate.db.repositories.playlists_tracks import add_playlist_tracks
from crate.db.repositories.playlist_refinement_proposals import (
    apply_refinement_proposal,
    prepare_refinement_proposal,
)
from crate.db.tx import transaction_scope
from sqlalchemy import text


def _seed(pg_db):
    pg_db.upsert_artist({"name": "Editorial Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Editorial Artist",
            "name": "Record",
            "path": "/music/editorial",
            "track_count": 2,
            "total_size": 0,
            "formats": ["flac"],
        }
    )
    ids = []
    for index, title in enumerate(("Song", "Song"), 1):
        path = f"/music/editorial/{index}.flac"
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Editorial Artist",
                "album": "Record",
                "filename": f"{index}.flac",
                "title": title,
                "track_number": index,
                "format": "flac",
                "duration": 180,
                "size": 10,
                "path": path,
            }
        )
        ids.append(pg_db.get_library_track_by_path(path)["id"])
    with transaction_scope() as session:
        actor = session.execute(
            text(
                "INSERT INTO users(email,username,created_at) VALUES ('editorial@test.invalid','editorial',NOW()) RETURNING id"
            )
        ).scalar_one()
    playlist_id = create_playlist("Refine", scope="system")
    add_playlist_tracks(
        playlist_id, [{"track_id": value, "source": "generated"} for value in ids]
    )
    return actor, playlist_id


def test_refinement_uses_stored_actions_and_empty_selection_changes_nothing(pg_db):
    actor, playlist_id = _seed(pg_db)
    proposal = prepare_refinement_proposal(playlist_id, actor)
    assert proposal["actions"]

    assert (
        apply_refinement_proposal(proposal["proposal_id"], playlist_id, actor, []) == 0
    )
    assert len(get_playlist_tracks(playlist_id)) == 2

    proposal = prepare_refinement_proposal(playlist_id, actor)
    with pytest.raises(ValueError, match="action"):
        apply_refinement_proposal(
            proposal["proposal_id"], playlist_id, actor, ["remove:999"]
        )
    assert len(get_playlist_tracks(playlist_id)) == 2

    selected = [proposal["actions"][0]["id"]]
    assert (
        apply_refinement_proposal(proposal["proposal_id"], playlist_id, actor, selected)
        == 1
    )
    assert len(get_playlist_tracks(playlist_id)) == 1


def test_refinement_rejects_other_actor_and_stale_revision(pg_db):
    actor, playlist_id = _seed(pg_db)
    proposal = prepare_refinement_proposal(playlist_id, actor)
    selected = [proposal["actions"][0]["id"]]
    with pytest.raises(ValueError, match="actor"):
        apply_refinement_proposal(
            proposal["proposal_id"], playlist_id, actor + 1, selected
        )
    update_playlist(playlist_id, name="Changed")
    with pytest.raises(ValueError, match="revision"):
        apply_refinement_proposal(proposal["proposal_id"], playlist_id, actor, selected)


def test_refinement_rechecks_persistent_exclusions(pg_db):
    actor, playlist_id = _seed(pg_db)
    proposal = prepare_refinement_proposal(playlist_id, actor)
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO playlist_track_exclusions
            (playlist_id,track_path) VALUES (:id,'/music/new-exclusion.flac')"""),
            {"id": playlist_id},
        )
    with pytest.raises(ValueError, match="exclusions"):
        apply_refinement_proposal(
            proposal["proposal_id"], playlist_id, actor, [proposal["actions"][0]["id"]]
        )
