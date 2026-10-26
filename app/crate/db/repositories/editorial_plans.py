"""Private editorial evidence and atomic application to the existing playlist model."""

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope, read_scope


def _hash(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str).encode()
    ).hexdigest()


def _record_applied(
    current, playlist_id: int, execution: dict, track_count: int
) -> None:
    current.execute(
        text("""INSERT INTO audit_log
            (timestamp,action,target_type,target_name,details_json)
            VALUES (NOW(),'playlist.editorial.applied','system_playlist',
                    CAST(:playlist_id AS text),CAST(:details AS jsonb))"""),
        {
            "playlist_id": playlist_id,
            "details": json.dumps(
                {
                    "kind": execution["kind"],
                    "principal_id": execution.get("actor_principal_id"),
                    "track_count": track_count,
                }
            ),
        },
    )


def _public_track(row: dict) -> dict:
    return {
        key: row.get(key)
        for key in (
            "row_id",
            "track_uid",
            "global_track_uid",
            "title",
            "artist",
            "album",
            "duration",
            "position",
            "source",
            "locked",
            "available",
        )
    }


def _tracks(current, playlist_id: int) -> list[dict]:
    return [
        dict(row)
        for row in current.execute(
            text("""
        SELECT pt.id AS row_id,pt.track_id,pt.track_entity_uid::text AS track_uid,
               pt.track_storage_id::text AS storage_id,pt.track_path AS path,
               pt.global_track_uid::text AS global_track_uid,pt.title,pt.artist,
               pt.album,pt.duration,pt.position,pt.source,pt.locked,
               (lt.id IS NOT NULL AND (lt.storage_id IS NOT NULL OR lt.path IS NOT NULL)
                OR gt.global_track_uid IS NOT NULL AND (gt.has_local OR gt.has_remote)) AS available
        FROM playlist_tracks pt LEFT JOIN library_tracks lt
          ON lt.entity_uid=pt.track_entity_uid
        LEFT JOIN global_catalog_tracks gt ON gt.global_track_uid=pt.global_track_uid
        WHERE pt.playlist_id=:id ORDER BY pt.position,pt.id
    """),
            {"id": playlist_id},
        ).mappings()
    ]


def _exclusions(current, playlist_id: int) -> list[dict]:
    return [
        dict(row)
        for row in current.execute(
            text("""
        SELECT id,track_id,track_entity_uid::text AS track_uid,track_storage_id::text AS storage_id,
               global_track_uid::text AS global_track_uid,track_path AS path
        FROM playlist_track_exclusions WHERE playlist_id=:id ORDER BY id
    """),
            {"id": playlist_id},
        ).mappings()
    ]


def _snapshot(current, playlist_id: int, *, lock=False) -> dict:
    playlist = (
        current.execute(
            text(
                """
        SELECT id,name,description,scope,visibility,generation_mode,smart_rules_json,
               is_active,auto_refresh_enabled,is_curated,category,editorial_revision,
               generation_epoch,track_count,total_duration
        FROM playlists WHERE id=:id
    """
                + (" FOR UPDATE" if lock else " FOR SHARE")
            ),
            {"id": playlist_id},
        )
        .mappings()
        .first()
    )
    if playlist is None or playlist["scope"] != "system":
        raise DiagnosticError("NOT_FOUND", "System playlist was not found")
    tracks, exclusions = (
        _tracks(current, playlist_id),
        _exclusions(current, playlist_id),
    )
    state = {
        "playlist": dict(playlist),
        "tracks": tracks,
        "exclusions": exclusions,
    }
    state["state_hash"] = _hash(state)
    return state


def snapshot_system_playlist(playlist_id: int, *, session=None) -> dict:
    if session is not None:
        return _snapshot(session, playlist_id)
    with read_scope() as current:
        return _snapshot(current, playlist_id)


def list_editorial_playlists(*, limit=20, offset=0, session=None) -> dict:
    def read(current):
        rows = [
            dict(row)
            for row in current.execute(
                text("""
            SELECT id,name,description,generation_mode,is_active,auto_refresh_enabled,
                   track_count,total_duration,editorial_revision,generation_epoch,
                   updated_at
            FROM playlists WHERE scope='system' ORDER BY id DESC
            LIMIT :limit OFFSET :offset
        """),
                {"limit": limit + 1, "offset": offset},
            ).mappings()
        ]
        return {"items": rows[:limit], "has_more": len(rows) > limit, "offset": offset}

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def read_editorial_playlist(
    playlist_id: int, *, section="tracks", limit=20, offset=0, session=None
) -> dict:
    def read(current):
        playlist = (
            current.execute(
                text("""
            SELECT id,name,description,scope,visibility,generation_mode,smart_rules_json,
                   is_active,auto_refresh_enabled,is_curated,category,editorial_revision,
                   generation_epoch,track_count,total_duration
            FROM playlists WHERE id=:id AND scope='system'
        """),
                {"id": playlist_id},
            )
            .mappings()
            .first()
        )
        if playlist is None:
            raise DiagnosticError("NOT_FOUND", "System playlist was not found")
        if section == "tracks":
            table = "playlist_tracks"
            rows = [
                dict(row)
                for row in current.execute(
                    text("""
                SELECT pt.id AS row_id,pt.track_entity_uid::text AS track_uid,
                       pt.global_track_uid::text AS global_track_uid,pt.title,pt.artist,
                       pt.album,pt.duration,pt.position,pt.source,pt.locked,
                       (lt.id IS NOT NULL AND (lt.storage_id IS NOT NULL OR lt.path IS NOT NULL)
                        OR gt.global_track_uid IS NOT NULL AND (gt.has_local OR gt.has_remote)) AS available
                FROM playlist_tracks pt LEFT JOIN library_tracks lt
                    ON lt.entity_uid=pt.track_entity_uid
                LEFT JOIN global_catalog_tracks gt ON gt.global_track_uid=pt.global_track_uid
                WHERE pt.playlist_id=:id ORDER BY pt.position,pt.id
                LIMIT :limit OFFSET :offset
            """),
                    {"id": playlist_id, "limit": limit, "offset": offset},
                ).mappings()
            ]
        elif section == "exclusions":
            table = "playlist_track_exclusions"
            rows = [
                dict(row)
                for row in current.execute(
                    text("""
                SELECT track_entity_uid::text AS track_uid,
                       global_track_uid::text AS global_track_uid
                FROM playlist_track_exclusions WHERE playlist_id=:id ORDER BY id
                LIMIT :limit OFFSET :offset
            """),
                    {"id": playlist_id, "limit": limit, "offset": offset},
                ).mappings()
            ]
        else:
            table = None
            rows = [
                dict(row)
                for row in current.execute(
                    text("""
                SELECT * FROM (
                    SELECT id,'generation' AS event_type,status,
                           triggered_by AS kind,NULL::text AS actor_principal_id,
                           track_count,started_at AS occurred_at
                    FROM playlist_generation_log WHERE playlist_id=:id
                    UNION ALL
                    SELECT id,'editorial' AS event_type,'applied' AS status,
                           details_json->>'kind' AS kind,
                           details_json->>'principal_id' AS actor_principal_id,
                           (details_json->>'track_count')::integer AS track_count,
                           timestamp AS occurred_at
                    FROM audit_log WHERE target_type='system_playlist'
                      AND action='playlist.editorial.applied'
                      AND target_name=CAST(:id AS text)
                ) events ORDER BY occurred_at DESC,id DESC
                LIMIT :limit OFFSET :offset
            """),
                    {"id": playlist_id, "limit": limit, "offset": offset},
                ).mappings()
            ]
        # SQL_SAFE: table is chosen from fixed literals above.
        count_sql = (
            f"SELECT COUNT(*) FROM {table} WHERE playlist_id=:id"
            if table
            else """SELECT
                (SELECT COUNT(*) FROM playlist_generation_log WHERE playlist_id=:id)
                + (SELECT COUNT(*) FROM audit_log
                   WHERE target_type='system_playlist'
                     AND action='playlist.editorial.applied'
                     AND target_name=CAST(:id AS text))"""
        )
        total = int(
            current.execute(
                text(count_sql),
                {"id": playlist_id},
            ).scalar_one()
        )
        return {
            "playlist": dict(playlist),
            "section": section,
            "items": rows,
            "total": total,
            "next_offset": offset + limit if offset + limit < total else None,
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def resolve_track_uids(uids: list[str], *, session=None, lock=False) -> dict[str, dict]:
    def read(current):
        rows = current.execute(
            text(
                """
            SELECT t.id,t.entity_uid::text AS track_uid,t.storage_id::text AS storage_id,
                   t.path,t.title,t.artist,t.album,t.duration,
                   (SELECT g.global_track_uid::text FROM global_catalog_tracks g
                    WHERE g.local_track_id=t.id OR g.local_track_entity_uid=t.entity_uid
                    ORDER BY g.local_track_id=t.id DESC LIMIT 1) AS global_track_uid
            FROM library_tracks t WHERE t.entity_uid=ANY(CAST(:uids AS uuid[]))
              AND (t.storage_id IS NOT NULL OR t.path IS NOT NULL)
        """
                + (" FOR SHARE" if lock else "")
            ),
            {"uids": uids},
        ).mappings()
        result = {}
        for row in rows:
            item = dict(row)
            item["fingerprint"] = _hash(item)
            result[item["track_uid"]] = item
        return result

    if not uids:
        return {}
    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def resolve_global_track_uids(
    uids: list[str], *, session=None, lock=False
) -> dict[str, dict]:
    def read(current):
        rows = current.execute(
            text(
                """SELECT global_track_uid::text AS global_track_uid,
                canonical_title,artist_name,album_name,duration_seconds,has_local,has_remote
                FROM global_catalog_tracks
                WHERE global_track_uid=ANY(CAST(:uids AS uuid[]))
                AND (has_local OR has_remote)"""
                + (" FOR SHARE" if lock else "")
            ),
            {"uids": uids},
        ).mappings()
        result = {}
        for row in rows:
            item = dict(row)
            item["fingerprint"] = _hash(item)
            result[item["global_track_uid"]] = item
        return result

    if not uids:
        return {}
    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def search_editorial_candidates(query: str, *, limit=20, session=None) -> list[dict]:
    def read(current):
        rows = current.execute(
            text("""
            SELECT id,entity_uid::text AS track_uid,title,artist,album,duration,
                   storage_id IS NOT NULL OR path IS NOT NULL AS available
            FROM library_tracks WHERE entity_uid IS NOT NULL
              AND (title ILIKE :query OR artist ILIKE :query OR album ILIKE :query)
            ORDER BY artist,title,id LIMIT :limit
        """),
            {
                "query": "%" + query.replace("%", "\\%").replace("_", "\\_") + "%",
                "limit": limit,
            },
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def validate_editorial_execution(execution: dict, *, session=None) -> dict:
    def check(current):
        playlist_id = execution.get("source_playlist_id") or execution.get(
            "playlist_id"
        )
        if playlist_id is not None:
            state = _snapshot(current, playlist_id)
            if (
                state["playlist"]["editorial_revision"] != execution["revision"]
                or state["playlist"]["generation_epoch"] != execution["epoch"]
                or state["state_hash"] != execution["state_hash"]
            ):
                raise DiagnosticError(
                    "PLAN_STALE", "Playlist changed since editorial preparation"
                )
        selected = execution.get("selection") or []
        uids = list({item["track_uid"] for item in selected if item.get("track_uid")})
        resolved = resolve_track_uids(uids, session=current, lock=True)
        global_uids = list(
            {
                item["global_track_uid"]
                for item in selected
                if item.get("global_track_uid") and not item.get("track_uid")
            }
        )
        global_resolved = resolve_global_track_uids(
            global_uids, session=current, lock=True
        )
        for item in selected:
            uid = item.get("track_uid")
            if uid and (
                uid not in resolved
                or resolved[uid]["fingerprint"] != item["fingerprint"]
            ):
                raise DiagnosticError(
                    "EVIDENCE_STALE", "Selected library track changed or disappeared"
                )
            global_uid = item.get("global_track_uid") if not uid else None
            if global_uid and (
                global_uid not in global_resolved
                or global_resolved[global_uid]["fingerprint"]
                != item.get("global_fingerprint")
            ):
                raise DiagnosticError(
                    "EVIDENCE_STALE", "Selected global track changed or disappeared"
                )
        excluded_uids = execution.get("new_exclusions", [])
        excluded_resolved = resolve_track_uids(
            excluded_uids, session=current, lock=True
        )
        if any(
            uid not in excluded_resolved
            or excluded_resolved[uid]["fingerprint"]
            != execution.get("new_exclusion_fingerprints", {}).get(uid)
            for uid in excluded_uids
        ):
            raise DiagnosticError(
                "EVIDENCE_STALE", "Excluded library track changed or disappeared"
            )
        return {
            "valid": True,
            "track_count": len(selected),
            "duration_seconds": sum(
                float(item.get("duration") or 0) for item in selected
            ),
        }

    if session is not None:
        return check(session)
    with read_scope() as current:
        return check(current)


def get_owned_editorial_execution(principal, plan_id: str, *, session=None) -> dict:
    from crate.db.repositories.agent_plans import _get
    from crate.db.repositories.agent_requests import _authorize
    from crate.agent_access import authorization_context

    def read(current):
        row = _get(current, plan_id)
        if (
            row["operation"] != "editorial_change"
            or str(row["principal_id"]) != principal.id
            or row["authorization_context"] != authorization_context(principal)
        ):
            raise DiagnosticError("NOT_FOUND", "Owned editorial plan was not found")
        _authorize(current, principal, row["required_grants"])
        return {
            "execution": row["execution_data"],
            "document": row["document"],
            "version": row["version"],
            "state": row["state"],
            "expires_at": row["expires_at"],
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def apply_editorial_execution(execution: dict, *, session=None) -> dict:
    with optional_scope(session) as current:
        kind = execution["kind"]
        playlist_id = execution.get("playlist_id")
        if playlist_id is not None:
            # The row lock is held through validation and every mutation.
            state = _snapshot(current, playlist_id, lock=True)
        else:
            state = None
        validate_editorial_execution(execution, session=current)
        if kind == "visibility":
            if playlist_id is None or state is None:
                raise DiagnosticError("PLAN_STALE", "System playlist was not found")
            current.execute(
                text("""UPDATE playlists SET is_active=:active,
                updated_at=NOW() WHERE id=:id"""),
                {"active": execution["is_active"], "id": playlist_id},
            )
            emit_playlist_domain_event(
                current,
                playlist_id=playlist_id,
                action="updated",
                payload={"editorial": True},
            )
            _record_applied(current, playlist_id, execution, len(state["tracks"]))
            return {
                "playlist_id": playlist_id,
                "is_active": execution["is_active"],
                "track_count": len(state["tracks"]),
            }
        if kind == "refresh_policy":
            if playlist_id is None or state is None:
                raise DiagnosticError("PLAN_STALE", "System playlist was not found")
            current.execute(
                text("""UPDATE playlists SET auto_refresh_enabled=:enabled,
                generation_epoch=generation_epoch+1,updated_at=NOW() WHERE id=:id"""),
                {"enabled": execution["auto_refresh_enabled"], "id": playlist_id},
            )
            emit_playlist_domain_event(
                current,
                playlist_id=playlist_id,
                action="updated",
                payload={"editorial": True},
            )
            _record_applied(current, playlist_id, execution, len(state["tracks"]))
            return {
                "playlist_id": playlist_id,
                "auto_refresh_enabled": execution["auto_refresh_enabled"],
                "is_active": state["playlist"]["is_active"],
                "track_count": len(state["tracks"]),
            }
        if playlist_id is None:
            playlist_id = create_playlist(
                execution["name"],
                description=execution["description"],
                scope="system",
                visibility="public",
                generation_mode=execution["generation_mode"],
                is_smart=execution["generation_mode"] == "smart",
                smart_rules=execution.get("smart_rules"),
                is_active=execution.get("is_active", False),
                auto_refresh_enabled=False,
                is_curated=True,
                managed_by_user_id=execution.get("managed_by_user_id"),
                session=current,
            )
        else:
            current.execute(
                text("""UPDATE playlists SET name=:name,description=:description,
                generation_mode=:mode,is_smart=:smart,smart_rules_json=CAST(:rules AS jsonb),
                auto_refresh_enabled=:auto_refresh,
                generation_epoch=generation_epoch+1,updated_at=NOW() WHERE id=:id"""),
                {
                    "id": playlist_id,
                    "name": execution["name"],
                    "description": execution["description"],
                    "mode": execution["generation_mode"],
                    "smart": execution["generation_mode"] == "smart",
                    "rules": json.dumps(execution.get("smart_rules")),
                    "auto_refresh": execution["planned_auto_refresh_enabled"],
                },
            )
        selection = execution["selection"]
        retained_ids = [item["row_id"] for item in selection if item.get("row_id")]
        current.execute(
            text("""DELETE FROM playlist_tracks WHERE playlist_id=:id
            AND NOT (id=ANY(CAST(:retained AS integer[])))"""),
            {"id": playlist_id, "retained": retained_ids},
        )
        now = datetime.now(timezone.utc)
        for position, item in enumerate(selection, 1):
            values = {
                "playlist_id": playlist_id,
                "position": position,
                "track_id": item.get("track_id"),
                "track_uid": item.get("track_uid"),
                "storage_id": item.get("storage_id"),
                "path": item.get("path"),
                "global_uid": item.get("global_track_uid"),
                "title": item.get("title"),
                "artist": item.get("artist"),
                "album": item.get("album"),
                "duration": item.get("duration"),
                "source": item["source"],
                "locked": item["locked"],
                "now": now,
            }
            if item.get("row_id"):
                current.execute(
                    text("""UPDATE playlist_tracks SET position=:position,
                    track_id=:track_id,track_entity_uid=CAST(:track_uid AS uuid),
                    track_storage_id=CAST(:storage_id AS uuid),track_path=:path,
                    global_track_uid=CAST(:global_uid AS uuid),title=:title,
                    artist=:artist,album=:album,duration=:duration,
                    source=:source,locked=:locked WHERE id=:row_id AND playlist_id=:playlist_id"""),
                    {**values, "row_id": item["row_id"]},
                )
            else:
                current.execute(
                    text("""INSERT INTO playlist_tracks
                    (playlist_id,position,track_id,track_entity_uid,track_storage_id,track_path,
                     global_track_uid,title,artist,album,duration,source,locked,added_at)
                    VALUES (:playlist_id,:position,:track_id,CAST(:track_uid AS uuid),
                     CAST(:storage_id AS uuid),:path,CAST(:global_uid AS uuid),:title,:artist,
                     :album,:duration,:source,:locked,:now)"""),
                    values,
                )
        excluded_tracks = resolve_track_uids(
            execution.get("new_exclusions", []), session=current
        )
        for uid in execution.get("new_exclusions", []):
            excluded = excluded_tracks[uid]
            current.execute(
                text("""INSERT INTO playlist_track_exclusions
                (playlist_id,track_id,track_entity_uid,track_storage_id,track_path,global_track_uid)
                VALUES (:playlist_id,:track_id,CAST(:uid AS uuid),CAST(:storage_id AS uuid),
                        :path,CAST(:global_uid AS uuid))
                ON CONFLICT DO NOTHING"""),
                {
                    "playlist_id": playlist_id,
                    "track_id": excluded["id"],
                    "uid": uid,
                    "storage_id": excluded["storage_id"],
                    "path": excluded["path"],
                    "global_uid": excluded["global_track_uid"],
                },
            )
        for item in execution.get("copied_exclusions", []):
            current.execute(
                text("""INSERT INTO playlist_track_exclusions
                (playlist_id,track_id,track_entity_uid,track_storage_id,global_track_uid,track_path)
                VALUES (:playlist_id,:track_id,CAST(:track_uid AS uuid),CAST(:storage_id AS uuid),
                        CAST(:global_track_uid AS uuid),:path)
                ON CONFLICT DO NOTHING"""),
                {
                    "playlist_id": playlist_id,
                    **{
                        key: item.get(key)
                        for key in (
                            "track_id",
                            "track_uid",
                            "storage_id",
                            "global_track_uid",
                            "path",
                        )
                    },
                },
            )
        total_duration = sum(float(item.get("duration") or 0) for item in selection)
        current.execute(
            text("""UPDATE playlists SET track_count=:count,total_duration=:duration,
            updated_at=NOW() WHERE id=:id"""),
            {"id": playlist_id, "count": len(selection), "duration": total_duration},
        )
        emit_playlist_domain_event(
            current,
            playlist_id=playlist_id,
            action="tracks_replaced",
            payload={"editorial": True, "track_count": len(selection)},
        )
        _record_applied(current, playlist_id, execution, len(selection))
        return {
            "playlist_id": playlist_id,
            "track_count": len(selection),
            "duration_seconds": total_duration,
            "is_active": execution.get(
                "is_active", state["playlist"]["is_active"] if state else False
            ),
        }


__all__ = [
    "snapshot_system_playlist",
    "list_editorial_playlists",
    "read_editorial_playlist",
    "resolve_track_uids",
    "resolve_global_track_uids",
    "search_editorial_candidates",
    "validate_editorial_execution",
    "apply_editorial_execution",
    "get_owned_editorial_execution",
]
