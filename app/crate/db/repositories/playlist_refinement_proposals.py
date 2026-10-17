"""Server-owned, revision-bound Admin refinement actions."""

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import text

from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.repositories.playlists_tracks import remove_playlist_track
from crate.db.tx import optional_scope
from crate.playlist_refinement import build_playlist_refinement_proposal


def _exclusion_hash(current, playlist_id: int) -> str:
    rows = [
        dict(row)
        for row in current.execute(
            text("""SELECT global_track_uid::text AS global_uid,
            track_entity_uid::text AS entity_uid,track_storage_id::text AS storage_id,
            track_path,track_id FROM playlist_track_exclusions
            WHERE playlist_id=:id ORDER BY id"""),
            {"id": playlist_id},
        ).mappings()
    ]
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def prepare_refinement_proposal(
    playlist_id: int, actor_user_id: int, *, session=None
) -> dict:
    with optional_scope(session) as current:
        playlist = (
            current.execute(
                text("""SELECT id,scope,name,smart_rules_json,editorial_revision
                    FROM playlists WHERE id=:id FOR UPDATE"""),
                {"id": playlist_id},
            )
            .mappings()
            .first()
        )
        if playlist is None or playlist["scope"] != "system":
            raise ValueError("System playlist not found")
        tracks = get_playlist_tracks(playlist_id, session=current)
        proposal = build_playlist_refinement_proposal(
            playlist={
                "name": playlist["name"],
                "smart_rules": playlist["smart_rules_json"],
            },
            tracks=tracks,
            smart_rules=playlist["smart_rules_json"],
        )
        proposal_id = str(uuid4())
        current.execute(
            text("""INSERT INTO playlist_refinement_proposals
                (id,playlist_id,actor_user_id,editorial_revision,exclusion_hash,actions)
                VALUES (:id,:playlist_id,:actor,:revision,:exclusion_hash,CAST(:actions AS jsonb))"""),
            {
                "id": proposal_id,
                "playlist_id": playlist_id,
                "actor": actor_user_id,
                "revision": playlist["editorial_revision"],
                "exclusion_hash": _exclusion_hash(current, playlist_id),
                "actions": json.dumps(proposal["actions"]),
            },
        )
        return {
            **proposal,
            "proposal_id": proposal_id,
            "editorial_revision": playlist["editorial_revision"],
        }


def apply_refinement_proposal(
    proposal_id: str,
    playlist_id: int,
    actor_user_id: int,
    selected_action_ids: list[str],
    *,
    session=None,
) -> int:
    with optional_scope(session) as current:
        proposal = (
            current.execute(
                text("""SELECT * FROM playlist_refinement_proposals
                    WHERE id=CAST(:id AS uuid) FOR UPDATE"""),
                {"id": proposal_id},
            )
            .mappings()
            .first()
        )
        if proposal is None or proposal["playlist_id"] != playlist_id:
            raise ValueError("Refinement proposal not found")
        if proposal["actor_user_id"] != actor_user_id:
            raise ValueError("Refinement proposal belongs to another actor")
        if proposal["applied_at"] is not None or not proposal[
            "expires_at"
        ] > datetime.now(timezone.utc):
            raise ValueError("Refinement proposal expired or applied")
        playlist = (
            current.execute(
                text("""SELECT id,scope,editorial_revision FROM playlists
                    WHERE id=:id FOR UPDATE"""),
                {"id": playlist_id},
            )
            .mappings()
            .first()
        )
        if (
            playlist is None
            or playlist["scope"] != "system"
            or playlist["editorial_revision"] != proposal["editorial_revision"]
        ):
            raise ValueError("Playlist revision changed since refinement preparation")
        if proposal["exclusion_hash"] != _exclusion_hash(current, playlist_id):
            raise ValueError("Playlist exclusions changed since refinement preparation")
        actions = {action["id"]: action for action in proposal["actions"]}
        if len(selected_action_ids) != len(set(selected_action_ids)) or any(
            action_id not in actions for action_id in selected_action_ids
        ):
            raise ValueError("Unknown or duplicate refinement action")
        selected = [actions[action_id] for action_id in selected_action_ids]
        removable = [action for action in selected if action["type"] == "remove_track"]
        row_ids = [action["track_id"] for action in removable]
        if len(row_ids) != len(set(row_ids)):
            raise ValueError("Duplicate refinement action target")
        locked_rows = {
            row["id"]: row
            for row in current.execute(
                text("""SELECT id,position,source,locked FROM playlist_tracks
                    WHERE playlist_id=:playlist_id AND id=ANY(CAST(:ids AS integer[]))
                    FOR UPDATE"""),
                {"playlist_id": playlist_id, "ids": row_ids},
            ).mappings()
        }
        for action in removable:
            row = locked_rows.get(action["track_id"])
            if (
                row is None
                or row["position"] != action["position"]
                or row["source"] != "generated"
                or row["locked"]
            ):
                raise ValueError("Refinement action target changed")
        for action in sorted(
            removable, key=lambda item: item["position"], reverse=True
        ):
            remove_playlist_track(
                playlist_id,
                action["position"],
                session=current,
                record_exclusion=True,
                excluded_by_user_id=actor_user_id,
            )
        current.execute(
            text(
                "UPDATE playlist_refinement_proposals SET applied_at=NOW() WHERE id=:id"
            ),
            {"id": proposal_id},
        )
        return len(removable)


__all__ = ["apply_refinement_proposal", "prepare_refinement_proposal"]
