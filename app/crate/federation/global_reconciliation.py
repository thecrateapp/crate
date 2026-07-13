"""Reconciliation routines for the federated global catalog."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.tx import read_scope, transaction_scope
from crate.federation.global_decisions import (
    force_merge_target_for_source,
    merge_blocked_for_source,
)
from crate.federation.global_matching import (
    MatchScore,
    normalize_name,
    score_album_match,
    score_artist_match,
    score_track_match,
)
from crate.federation.global_sources import (
    get_local_source,
    get_remote_source,
    iter_local_sources,
    iter_remote_sources,
)

_GLOBAL_UID_NAMESPACE = uuid.UUID("e43655c7-8af2-4c5a-92f6-a5126dff7f84")


def reconcile_dirty_catalog_sources(*, limit: int = 500) -> dict[str, int]:
    """Project only claimed dirty local sources into the canonical catalog."""
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
        fail_dirty_source,
    )

    with transaction_scope() as session:
        claimed = claim_dirty_sources(limit, session=session)

    completed = 0
    failed = 0
    for dirty in claimed:
        source_id = int(dirty["id"])
        try:
            with transaction_scope() as session:
                _reconcile_dirty_source(session, dirty)
                complete_dirty_source(source_id, session=session)
            completed += 1
        except Exception as exc:
            with transaction_scope() as session:
                fail_dirty_source(source_id, str(exc), session=session)
            failed += 1

    with read_scope() as session:
        remaining = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_dirty_sources
                WHERE completed_at IS NULL
                  AND claimed_at IS NULL
                """
            )
        ).scalar_one()

    return {
        "claimed": len(claimed),
        "completed": completed,
        "failed": failed,
        "remaining": int(remaining),
    }


def _reconcile_dirty_source(session, dirty: dict[str, Any]) -> None:
    entity_type = str(dirty["entity_type"])
    source_kind = str(dirty["source_kind"])
    operation = str(dirty["operation"])

    if source_kind == "local":
        entity_uid = str(dirty.get("local_entity_uid") or "")
        if not entity_uid:
            raise ValueError("Local dirty source is missing entity UID")
        if operation == "delete":
            tombstone_local_source(entity_type, entity_uid, session=session)
            return
        source = get_local_source(entity_type, entity_uid)
        if source is None:
            tombstone_local_source(entity_type, entity_uid, session=session)
            return
        _reconcile_local_source(session, source)
        return

    if source_kind == "federated":
        node_uid = str(dirty.get("node_uid") or "")
        remote_entity_uid = str(dirty.get("remote_entity_uid") or "")
        if not node_uid or not remote_entity_uid:
            raise ValueError(
                "Federated dirty source is missing node or remote entity UID"
            )
        if operation == "delete":
            tombstone_federated_source(
                entity_type,
                node_uid,
                remote_entity_uid,
                session=session,
            )
            return
        source = get_remote_source(node_uid, entity_type, remote_entity_uid)
        if source is None or source["source_stale"]:
            tombstone_federated_source(
                entity_type,
                node_uid,
                remote_entity_uid,
                session=session,
            )
            return
        _reconcile_federated_source(session, source)
        return

    raise ValueError(f"Unsupported dirty source kind: {source_kind}")


def _reconcile_local_source(session, source: dict[str, Any]) -> None:
    entity_type = source["entity_type"]
    global_uid = _global_uid(source)
    if entity_type == "artist":
        _upsert_artist(session, source)
    elif entity_type == "album":
        artist_uid = _find_artist_uid(session, source["source_payload"]["artist_name"])
        if artist_uid is None:
            raise RuntimeError("Album source is waiting for its canonical artist")
        _upsert_album(session, source, artist_uid)
    elif entity_type == "track":
        payload = source["source_payload"]
        artist_uid = _find_artist_uid(session, payload["artist_name"])
        if artist_uid is None:
            raise RuntimeError("Track source is waiting for its canonical artist")
        album_uid = _find_album_uid(
            session,
            artist_name=payload["artist_name"],
            album_name=payload.get("album_name"),
        )
        _upsert_track(session, source, artist_uid, album_uid)
    else:
        raise ValueError(f"Unsupported local catalog entity type: {entity_type}")

    source_id = _upsert_source(session, source, global_uid, preferred=True)
    _project_source_genres(session, source, global_uid, source_id)
    _refresh_source_count(session, entity_type, global_uid)


def _reconcile_federated_source(session, source: dict[str, Any]) -> None:
    """Project one peer source without scanning the peer's full catalog."""
    entity_type = source["entity_type"]
    if entity_type == "artist":
        target_uid, score = _resolve_artist_target(session, source)
        source = _with_match(source, score)
        _upsert_remote_artist(session, source, target_uid)
        preferred = not _canonical_has_local(session, "artist", target_uid)
        source_id = _upsert_source(session, source, target_uid, preferred=preferred)
        _project_source_genres(session, source, target_uid, source_id)
        _refresh_artist_has_photo(session, target_uid)
    elif entity_type == "album":
        artist_uid = _find_artist_uid(session, source["source_payload"]["artist_name"])
        if artist_uid is None:
            raise RuntimeError(
                "Federated album source is waiting for its canonical artist"
            )
        target_uid, score = _resolve_album_target(session, source, artist_uid)
        source = _with_match(source, score)
        _upsert_remote_album(session, source, target_uid, artist_uid)
        preferred = not _canonical_has_local(session, "album", target_uid)
        source_id = _upsert_source(session, source, target_uid, preferred=preferred)
        _project_source_genres(session, source, target_uid, source_id)
    elif entity_type == "track":
        payload = source["source_payload"]
        artist_uid = _find_artist_uid(session, payload["artist_name"])
        if artist_uid is None:
            raise RuntimeError(
                "Federated track source is waiting for its canonical artist"
            )
        album_uid = _find_album_uid(
            session,
            artist_name=payload["artist_name"],
            album_name=payload.get("album_name"),
        )
        target_uid, score = _resolve_track_target(session, source, artist_uid)
        source = _with_match(source, score)
        _upsert_remote_track(session, source, target_uid, artist_uid, album_uid)
        preferred = not _canonical_has_local(session, "track", target_uid)
        source_id = _upsert_source(session, source, target_uid, preferred=preferred)
        _project_source_genres(session, source, target_uid, source_id)
    else:
        raise ValueError(f"Unsupported federated catalog entity type: {entity_type}")
    _refresh_source_count(session, entity_type, target_uid)


def tombstone_local_source(entity_type: str, entity_uid: str, *, session) -> None:
    """Mark a local source deleted and remove its canonical row when orphaned."""
    table_name, id_column = _canonical_table(entity_type)
    row = (
        session.execute(
            text(
                """
                SELECT id, global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'local'
                  AND local_entity_uid = CAST(:entity_uid AS uuid)
                LIMIT 1
                """
            ),
            {"entity_type": entity_type, "entity_uid": entity_uid},
        )
        .mappings()
        .first()
    )
    if row is None:
        return

    global_uid = str(row["global_entity_uid"])
    session.execute(
        text(
            """
            UPDATE global_catalog_sources
            SET
                source_deleted_at = NOW(),
                source_stale = TRUE,
                preferred_for_display = FALSE,
                preferred_for_artwork = FALSE,
                preferred_for_playback = FALSE,
                updated_at = NOW()
            WHERE entity_type = :entity_type
              AND source_kind = 'local'
              AND local_entity_uid = CAST(:entity_uid AS uuid)
            """
        ),
        {"entity_type": entity_type, "entity_uid": entity_uid},
    )
    from crate.federation.global_genres import project_source_genre_assertions

    project_source_genre_assertions(
        session,
        source_id=int(row["id"]),
        entity_type=entity_type,
        global_entity_uid=global_uid,
        source_kind="local",
        source_revision=None,
        assertions=[],
    )
    _refresh_source_count(session, entity_type, global_uid)
    active_sources = session.execute(
        text(
            """
            SELECT COUNT(*)
            FROM global_catalog_sources
            WHERE entity_type = :entity_type
              AND global_entity_uid = CAST(:global_uid AS uuid)
              AND source_deleted_at IS NULL
              AND NOT source_stale
            """
        ),
        {"entity_type": entity_type, "global_uid": global_uid},
    ).scalar_one()
    if int(active_sources) == 0:
        session.execute(
            text(
                f"DELETE FROM {table_name} WHERE {id_column} = CAST(:global_uid AS uuid)"
            ),
            {"global_uid": global_uid},
        )


def tombstone_federated_source(
    entity_type: str,
    node_uid: str,
    remote_entity_uid: str,
    *,
    session,
) -> None:
    """Invalidate a peer source and prune an orphaned canonical row."""
    table_name, id_column = _canonical_table(entity_type)
    row = (
        session.execute(
            text(
                """
                SELECT id, global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'federated'
                  AND node_uid = CAST(:node_uid AS uuid)
                  AND remote_entity_uid = :remote_entity_uid
                LIMIT 1
                """
            ),
            {
                "entity_type": entity_type,
                "node_uid": node_uid,
                "remote_entity_uid": remote_entity_uid,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        return

    global_uid = str(row["global_entity_uid"])
    session.execute(
        text(
            """
            UPDATE global_catalog_sources
            SET
                source_deleted_at = NOW(),
                source_stale = TRUE,
                preferred_for_display = FALSE,
                preferred_for_artwork = FALSE,
                preferred_for_playback = FALSE,
                updated_at = NOW()
            WHERE id = :source_id
            """
        ),
        {"source_id": row["id"]},
    )
    from crate.federation.global_genres import project_source_genre_assertions

    project_source_genre_assertions(
        session,
        source_id=int(row["id"]),
        entity_type=entity_type,
        global_entity_uid=global_uid,
        source_kind="federated",
        source_revision=None,
        assertions=[],
    )
    _refresh_source_count(session, entity_type, global_uid)
    active_sources = session.execute(
        text(
            """
            SELECT COUNT(*)
            FROM global_catalog_sources
            WHERE entity_type = :entity_type
              AND global_entity_uid = CAST(:global_uid AS uuid)
              AND source_deleted_at IS NULL
              AND NOT source_stale
            """
        ),
        {"entity_type": entity_type, "global_uid": global_uid},
    ).scalar_one()
    if int(active_sources) == 0:
        session.execute(
            text(
                f"DELETE FROM {table_name} WHERE {id_column} = CAST(:global_uid AS uuid)"
            ),
            {"global_uid": global_uid},
        )


def reconcile_local_catalog(batch_size: int = 500) -> dict[str, Any]:
    """Rebuild/upsert canonical rows for local library sources only."""
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    _emit_reconcile_event("started", run_id=run_id, mode="local")
    try:
        sources = list(iter_local_sources(batch_size=batch_size))
        result = {
            "run_id": run_id,
            "mode": "local",
            "status": "completed",
            "source_rows_seen": len(sources),
            "sources_upserted": 0,
            "canonical_created": 0,
            "canonical_updated": 0,
        }

        with transaction_scope() as session:
            _insert_run(session, run_id=run_id, mode="local", started_at=started_at)

            for source in _sources_for_type(sources, "artist"):
                existed = _canonical_exists(
                    session,
                    "global_catalog_artists",
                    "global_artist_uid",
                    _global_uid(source),
                )
                _upsert_artist(session, source)
                source_id = _upsert_source(
                    session, source, _global_uid(source), preferred=True
                )
                _project_source_genres(session, source, _global_uid(source), source_id)
                _refresh_source_count(session, "artist", _global_uid(source))
                _count_result(result, existed)

            for source in _sources_for_type(sources, "album"):
                artist_uid = _find_artist_uid(
                    session, source["source_payload"]["artist_name"]
                )
                if artist_uid is None:
                    continue
                existed = _canonical_exists(
                    session,
                    "global_catalog_albums",
                    "global_album_uid",
                    _global_uid(source),
                )
                _upsert_album(session, source, artist_uid)
                source_id = _upsert_source(
                    session, source, _global_uid(source), preferred=True
                )
                _project_source_genres(session, source, _global_uid(source), source_id)
                _refresh_source_count(session, "album", _global_uid(source))
                _count_result(result, existed)

            for source in _sources_for_type(sources, "track"):
                payload = source["source_payload"]
                artist_uid = _find_artist_uid(session, payload["artist_name"])
                if artist_uid is None:
                    continue
                album_uid = _find_album_uid(
                    session,
                    artist_name=payload["artist_name"],
                    album_name=payload.get("album_name"),
                )
                existed = _canonical_exists(
                    session,
                    "global_catalog_tracks",
                    "global_track_uid",
                    _global_uid(source),
                )
                _upsert_track(session, source, artist_uid, album_uid)
                source_id = _upsert_source(
                    session, source, _global_uid(source), preferred=True
                )
                _project_source_genres(session, source, _global_uid(source), source_id)
                _refresh_source_count(session, "track", _global_uid(source))
                _count_result(result, existed)

            result["sources_upserted"] = (
                result["canonical_created"] + result["canonical_updated"]
            )
            _complete_run(session, run_id=run_id, result=result)
            _emit_reconcile_event("completed", result=result, session=session)

        return result
    except Exception as exc:
        _emit_reconcile_event("failed", run_id=run_id, mode="local", error=str(exc))
        raise


def reconcile_remote_catalog(
    batch_size: int = 500,
    node_uid: str | None = None,
) -> dict[str, Any]:
    """Reconcile raw federated catalog items into canonical rows."""
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    mode = "peer" if node_uid else "incremental"
    _emit_reconcile_event("started", run_id=run_id, mode=mode, node_uid=node_uid)
    try:
        sources = list(iter_remote_sources(batch_size=batch_size, node_uid=node_uid))
        result = {
            "run_id": run_id,
            "mode": mode,
            "status": "completed",
            "source_rows_seen": len(sources),
            "sources_upserted": 0,
            "canonical_created": 0,
            "canonical_updated": 0,
        }

        with transaction_scope() as session:
            _insert_run(
                session,
                run_id=run_id,
                mode=result["mode"],
                started_at=started_at,
            )

            for source in _sources_for_type(sources, "artist"):
                target_uid, score = _resolve_artist_target(session, source)
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session,
                    "global_catalog_artists",
                    "global_artist_uid",
                    target_uid,
                )
                _upsert_remote_artist(session, source, target_uid)
                preferred = not _canonical_has_local(session, "artist", target_uid)
                source_id = _upsert_source(
                    session, source, target_uid, preferred=preferred
                )
                _project_source_genres(session, source, target_uid, source_id)
                _refresh_artist_has_photo(session, target_uid)
                _refresh_source_count(session, "artist", target_uid)
                _count_result(result, existed)

            for source in _sources_for_type(sources, "album"):
                artist_uid = _find_artist_uid(
                    session, source["source_payload"]["artist_name"]
                )
                if artist_uid is None:
                    continue
                target_uid, score = _resolve_album_target(session, source, artist_uid)
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session,
                    "global_catalog_albums",
                    "global_album_uid",
                    target_uid,
                )
                _upsert_remote_album(session, source, target_uid, artist_uid)
                preferred = not _canonical_has_local(session, "album", target_uid)
                source_id = _upsert_source(
                    session, source, target_uid, preferred=preferred
                )
                _project_source_genres(session, source, target_uid, source_id)
                _refresh_source_count(session, "album", target_uid)
                _count_result(result, existed)

            for source in _sources_for_type(sources, "track"):
                payload = source["source_payload"]
                artist_uid = _find_artist_uid(session, payload["artist_name"])
                if artist_uid is None:
                    continue
                album_uid = _find_album_uid(
                    session,
                    artist_name=payload["artist_name"],
                    album_name=payload.get("album_name"),
                )
                target_uid, score = _resolve_track_target(session, source, artist_uid)
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session, "global_catalog_tracks", "global_track_uid", target_uid
                )
                _upsert_remote_track(session, source, target_uid, artist_uid, album_uid)
                preferred = not _canonical_has_local(session, "track", target_uid)
                source_id = _upsert_source(
                    session, source, target_uid, preferred=preferred
                )
                _project_source_genres(session, source, target_uid, source_id)
                _refresh_source_count(session, "track", target_uid)
                _count_result(result, existed)

            result["sources_upserted"] = (
                result["canonical_created"] + result["canonical_updated"]
            )
            _complete_run(session, run_id=run_id, result=result)
            _emit_reconcile_event("completed", result=result, session=session)

        return result
    except Exception as exc:
        _emit_reconcile_event("failed", run_id=run_id, mode=mode, error=str(exc))
        raise


def _insert_run(session, *, run_id: str, mode: str, started_at: datetime) -> None:
    session.execute(
        text(
            """
            INSERT INTO global_catalog_reconciliation_runs
                (run_id, mode, status, started_at)
            VALUES
                (:run_id, :mode, 'running', :started_at)
            """
        ),
        {"run_id": run_id, "mode": mode, "started_at": started_at},
    )


def _complete_run(session, *, run_id: str, result: dict[str, Any]) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_reconciliation_runs
            SET
                status = 'completed',
                completed_at = :completed_at,
                source_rows_seen = :source_rows_seen,
                sources_upserted = :sources_upserted,
                canonical_created = :canonical_created,
                canonical_updated = :canonical_updated
            WHERE run_id = :run_id
            """
        ),
        {
            "run_id": run_id,
            "completed_at": datetime.now(timezone.utc),
            "source_rows_seen": result["source_rows_seen"],
            "sources_upserted": result["sources_upserted"],
            "canonical_created": result["canonical_created"],
            "canonical_updated": result["canonical_updated"],
        },
    )


def _emit_reconcile_event(
    status: str,
    *,
    run_id: str | None = None,
    mode: str | None = None,
    node_uid: str | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    session=None,
) -> None:
    payload = dict(result or {})
    if run_id is not None:
        payload.setdefault("run_id", run_id)
    if mode is not None:
        payload.setdefault("mode", mode)
    if node_uid is not None:
        payload["node_uid"] = node_uid
    if error is not None:
        payload["error"] = error
    append_domain_event(
        f"global_catalog.reconcile.{status}",
        payload,
        scope="global_catalog",
        subject_key=str(payload.get("run_id") or ""),
        session=session,
    )


def _sources_for_type(
    sources: list[dict[str, Any]], entity_type: str
) -> list[dict[str, Any]]:
    return [source for source in sources if source["entity_type"] == entity_type]


def _global_uid(source: dict[str, Any]) -> str:
    source_key = (
        source.get("local_entity_uid")
        or source.get("local_id")
        or source.get("remote_entity_uid")
    )
    return str(
        uuid.uuid5(
            _GLOBAL_UID_NAMESPACE,
            f"{source['entity_type']}:{source['source_kind']}:{source_key}",
        )
    )


def _canonical_exists(
    session, table_name: str, id_column: str, global_uid: str
) -> bool:
    row = session.execute(
        text(f"SELECT 1 FROM {table_name} WHERE {id_column} = :global_uid"),
        {"global_uid": global_uid},
    ).first()
    return row is not None


def _count_result(result: dict[str, Any], existed: bool) -> None:
    if existed:
        result["canonical_updated"] += 1
    else:
        result["canonical_created"] += 1


def _resolve_artist_target(session, source: dict[str, Any]) -> tuple[str, MatchScore]:
    forced_target = force_merge_target_for_source(session, source)
    if forced_target:
        return forced_target, MatchScore(1.0, "manual_force_merge", auto_merge=True)

    payload = source["source_payload"]
    rows = _candidate_artists(session, payload)
    best_uid, best_score = _best_match(
        rows,
        payload,
        score_artist_match,
        uid_key="global_artist_uid",
    )
    if best_uid and best_score.auto_merge:
        if merge_blocked_for_source(session, source, best_uid):
            return _global_uid(source), MatchScore(
                best_score.confidence,
                "manual_force_split",
                candidate=True,
            )
        return best_uid, best_score
    return _global_uid(source), MatchScore(0.0, "new_remote_artist")


def _resolve_album_target(
    session,
    source: dict[str, Any],
    artist_uid: str,
) -> tuple[str, MatchScore]:
    forced_target = force_merge_target_for_source(session, source)
    if forced_target:
        return forced_target, MatchScore(1.0, "manual_force_merge", auto_merge=True)

    payload = source["source_payload"]
    rows = _candidate_albums(session, payload, artist_uid)
    best_uid, best_score = _best_match(
        rows,
        payload,
        score_album_match,
        uid_key="global_album_uid",
    )
    if best_uid and best_score.auto_merge:
        if merge_blocked_for_source(session, source, best_uid):
            return _global_uid(source), MatchScore(
                best_score.confidence,
                "manual_force_split",
                candidate=True,
            )
        return best_uid, best_score
    return _global_uid(source), best_score or MatchScore(0.0, "new_remote_album")


def _resolve_track_target(
    session,
    source: dict[str, Any],
    artist_uid: str,
) -> tuple[str, MatchScore]:
    forced_target = force_merge_target_for_source(session, source)
    if forced_target:
        return forced_target, MatchScore(1.0, "manual_force_merge", auto_merge=True)

    payload = source["source_payload"]
    rows = _candidate_tracks(session, payload, artist_uid)
    best_uid, best_score = _best_match(
        rows,
        payload,
        score_track_match,
        uid_key="global_track_uid",
    )
    if best_uid and best_score.auto_merge:
        if merge_blocked_for_source(session, source, best_uid):
            return _global_uid(source), MatchScore(
                best_score.confidence,
                "manual_force_split",
                candidate=True,
            )
        return best_uid, best_score
    return _global_uid(source), best_score or MatchScore(0.0, "new_remote_track")


def _best_match(
    rows: list[dict[str, Any]],
    payload: dict[str, Any],
    scorer,
    *,
    uid_key: str,
) -> tuple[str | None, MatchScore]:
    best_uid: str | None = None
    best_score = MatchScore(0.0, "no_match")
    for row in rows:
        score = scorer(payload, row)
        if score.confidence > best_score.confidence:
            best_uid = row[uid_key]
            best_score = score
    return best_uid, best_score


def _candidate_artists(session, payload: dict[str, Any]) -> list[dict[str, Any]]:
    row_mbid = payload.get("musicbrainz_artist_mbid")
    rows = (
        session.execute(
            text(
                """
                SELECT
                    global_artist_uid::text AS global_artist_uid,
                    canonical_name,
                    musicbrainz_artist_mbid
                FROM global_catalog_artists
                WHERE normalized_name = :normalized_name
                   OR (
                        :musicbrainz_artist_mbid IS NOT NULL
                        AND musicbrainz_artist_mbid = :musicbrainz_artist_mbid
                   )
                """
            ),
            {
                "normalized_name": payload["normalized_name"],
                "musicbrainz_artist_mbid": row_mbid,
            },
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _candidate_albums(
    session, payload: dict[str, Any], artist_uid: str
) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            text(
                """
                SELECT
                    global_album_uid::text AS global_album_uid,
                    canonical_name,
                    artist_name,
                    year,
                    track_count,
                    musicbrainz_release_group_mbid,
                    musicbrainz_release_mbid,
                    upc
                FROM global_catalog_albums
                WHERE global_artist_uid = :artist_uid
                  AND (
                    normalized_name = :normalized_name
                    OR (
                        :musicbrainz_release_mbid IS NOT NULL
                        AND musicbrainz_release_mbid = :musicbrainz_release_mbid
                    )
                    OR (
                        :musicbrainz_release_group_mbid IS NOT NULL
                        AND musicbrainz_release_group_mbid = :musicbrainz_release_group_mbid
                    )
                    OR (:upc IS NOT NULL AND upc = :upc)
                  )
                """
            ),
            {
                "artist_uid": artist_uid,
                "normalized_name": payload["normalized_name"],
                "musicbrainz_release_mbid": payload.get("musicbrainz_release_mbid"),
                "musicbrainz_release_group_mbid": payload.get(
                    "musicbrainz_release_group_mbid"
                ),
                "upc": payload.get("upc"),
            },
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _candidate_tracks(
    session, payload: dict[str, Any], artist_uid: str
) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            text(
                """
                SELECT
                    global_track_uid::text AS global_track_uid,
                    canonical_title,
                    artist_name,
                    album_name,
                    disc_number,
                    track_number,
                    duration_seconds,
                    musicbrainz_recording_mbid,
                    isrc
                FROM global_catalog_tracks
                WHERE global_artist_uid = :artist_uid
                  AND (
                    normalized_title = :normalized_title
                    OR (
                        :musicbrainz_recording_mbid IS NOT NULL
                        AND musicbrainz_recording_mbid = :musicbrainz_recording_mbid
                    )
                    OR (:isrc IS NOT NULL AND isrc = :isrc)
                  )
                """
            ),
            {
                "artist_uid": artist_uid,
                "normalized_title": payload["normalized_title"],
                "musicbrainz_recording_mbid": payload.get("musicbrainz_recording_mbid"),
                "isrc": payload.get("isrc"),
            },
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _with_match(source: dict[str, Any], score: MatchScore) -> dict[str, Any]:
    updated = dict(source)
    updated["match_confidence"] = score.confidence
    updated["match_method"] = score.method
    return updated


def _upsert_artist(session, source: dict[str, Any]) -> None:
    payload = source["source_payload"]
    session.execute(
        text(
            """
            INSERT INTO global_catalog_artists
                (
                    global_artist_uid,
                    canonical_name,
                    sort_name,
                    normalized_name,
                    musicbrainz_artist_mbid,
                    local_artist_id,
                    local_artist_entity_uid,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_photo,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :canonical_name,
                    :sort_name,
                    :normalized_name,
                    :musicbrainz_artist_mbid,
                    :local_id,
                    :local_entity_uid,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    true,
                    false,
                    :has_photo,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            ON CONFLICT (global_artist_uid) DO UPDATE SET
                canonical_name = EXCLUDED.canonical_name,
                sort_name = EXCLUDED.sort_name,
                normalized_name = EXCLUDED.normalized_name,
                musicbrainz_artist_mbid = EXCLUDED.musicbrainz_artist_mbid,
                local_artist_id = EXCLUDED.local_artist_id,
                local_artist_entity_uid = EXCLUDED.local_artist_entity_uid,
                display_source_json = EXCLUDED.display_source_json,
                availability_json = EXCLUDED.availability_json,
                match_json = EXCLUDED.match_json,
                source_count = EXCLUDED.source_count,
                has_local = true,
                has_photo = EXCLUDED.has_photo,
                search_vector = EXCLUDED.search_vector,
                updated_at = NOW()
            """
        ),
        {
            "global_uid": _global_uid(source),
            "canonical_name": payload["canonical_name"],
            "sort_name": payload["sort_name"],
            "normalized_name": payload["normalized_name"],
            "musicbrainz_artist_mbid": payload["musicbrainz_artist_mbid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": True, "remote": False}),
            "match_json": _json(_match_ref(source)),
            "has_photo": payload["has_photo"],
            "search_text": payload["canonical_name"],
        },
    )


def _upsert_album(session, source: dict[str, Any], artist_uid: str) -> None:
    payload = source["source_payload"]
    session.execute(
        text(
            """
            INSERT INTO global_catalog_albums
                (
                    global_album_uid,
                    global_artist_uid,
                    canonical_name,
                    normalized_name,
                    artist_name,
                    year,
                    track_count,
                    total_duration_seconds,
                    musicbrainz_release_group_mbid,
                    musicbrainz_release_mbid,
                    local_album_id,
                    local_album_entity_uid,
                    display_source_json,
                    artwork_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_cover,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :artist_uid,
                    :canonical_name,
                    :normalized_name,
                    :artist_name,
                    :year,
                    :track_count,
                    :total_duration_seconds,
                    :musicbrainz_release_group_mbid,
                    :musicbrainz_release_mbid,
                    :local_id,
                    :local_entity_uid,
                    :display_source_json,
                    :artwork_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    true,
                    false,
                    :has_cover,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            ON CONFLICT (global_album_uid) DO UPDATE SET
                global_artist_uid = EXCLUDED.global_artist_uid,
                canonical_name = EXCLUDED.canonical_name,
                normalized_name = EXCLUDED.normalized_name,
                artist_name = EXCLUDED.artist_name,
                year = EXCLUDED.year,
                track_count = EXCLUDED.track_count,
                total_duration_seconds = EXCLUDED.total_duration_seconds,
                musicbrainz_release_group_mbid = EXCLUDED.musicbrainz_release_group_mbid,
                musicbrainz_release_mbid = EXCLUDED.musicbrainz_release_mbid,
                local_album_id = EXCLUDED.local_album_id,
                local_album_entity_uid = EXCLUDED.local_album_entity_uid,
                display_source_json = EXCLUDED.display_source_json,
                artwork_source_json = EXCLUDED.artwork_source_json,
                availability_json = EXCLUDED.availability_json,
                match_json = EXCLUDED.match_json,
                source_count = EXCLUDED.source_count,
                has_local = true,
                has_cover = EXCLUDED.has_cover,
                search_vector = EXCLUDED.search_vector,
                updated_at = NOW()
            """
        ),
        {
            "global_uid": _global_uid(source),
            "artist_uid": artist_uid,
            "canonical_name": payload["canonical_name"],
            "normalized_name": payload["normalized_name"],
            "artist_name": payload["artist_name"],
            "year": payload["year"],
            "track_count": payload["track_count"],
            "total_duration_seconds": payload["total_duration_seconds"],
            "musicbrainz_release_group_mbid": payload["musicbrainz_release_group_mbid"],
            "musicbrainz_release_mbid": payload["musicbrainz_release_mbid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "display_source_json": _json(_source_ref(source)),
            "artwork_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": True, "remote": False}),
            "match_json": _json(_match_ref(source)),
            "has_cover": payload["has_cover"],
            "search_text": f"{payload['artist_name']} {payload['canonical_name']}",
        },
    )


def _upsert_track(
    session,
    source: dict[str, Any],
    artist_uid: str,
    album_uid: str | None,
) -> None:
    payload = source["source_payload"]
    session.execute(
        text(
            """
            INSERT INTO global_catalog_tracks
                (
                    global_track_uid,
                    global_album_uid,
                    global_artist_uid,
                    canonical_title,
                    normalized_title,
                    artist_name,
                    album_name,
                    disc_number,
                    track_number,
                    duration_seconds,
                    musicbrainz_recording_mbid,
                    local_track_id,
                    local_track_entity_uid,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :album_uid,
                    :artist_uid,
                    :canonical_title,
                    :normalized_title,
                    :artist_name,
                    :album_name,
                    :disc_number,
                    :track_number,
                    :duration_seconds,
                    :musicbrainz_recording_mbid,
                    :local_id,
                    :local_entity_uid,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    true,
                    false,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            ON CONFLICT (global_track_uid) DO UPDATE SET
                global_album_uid = EXCLUDED.global_album_uid,
                global_artist_uid = EXCLUDED.global_artist_uid,
                canonical_title = EXCLUDED.canonical_title,
                normalized_title = EXCLUDED.normalized_title,
                artist_name = EXCLUDED.artist_name,
                album_name = EXCLUDED.album_name,
                disc_number = EXCLUDED.disc_number,
                track_number = EXCLUDED.track_number,
                duration_seconds = EXCLUDED.duration_seconds,
                musicbrainz_recording_mbid = EXCLUDED.musicbrainz_recording_mbid,
                local_track_id = EXCLUDED.local_track_id,
                local_track_entity_uid = EXCLUDED.local_track_entity_uid,
                display_source_json = EXCLUDED.display_source_json,
                availability_json = EXCLUDED.availability_json,
                match_json = EXCLUDED.match_json,
                source_count = EXCLUDED.source_count,
                has_local = true,
                search_vector = EXCLUDED.search_vector,
                updated_at = NOW()
            """
        ),
        {
            "global_uid": _global_uid(source),
            "album_uid": album_uid,
            "artist_uid": artist_uid,
            "canonical_title": payload["canonical_title"],
            "normalized_title": payload["normalized_title"],
            "artist_name": payload["artist_name"],
            "album_name": payload["album_name"],
            "disc_number": payload["disc_number"],
            "track_number": payload["track_number"],
            "duration_seconds": payload["duration_seconds"],
            "musicbrainz_recording_mbid": payload["musicbrainz_recording_mbid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": True, "remote": False}),
            "match_json": _json(_match_ref(source)),
            "search_text": (
                f"{payload['artist_name']} {payload['album_name']} "
                f"{payload['canonical_title']}"
            ),
        },
    )


def _upsert_remote_artist(
    session,
    source: dict[str, Any],
    global_uid: str,
) -> None:
    payload = source["source_payload"]
    if _canonical_exists(
        session, "global_catalog_artists", "global_artist_uid", global_uid
    ):
        session.execute(
            text(
                """
                UPDATE global_catalog_artists
                SET has_remote = true, updated_at = NOW()
                WHERE global_artist_uid = :global_uid
                """
            ),
            {"global_uid": global_uid},
        )
        return

    session.execute(
        text(
            """
            INSERT INTO global_catalog_artists
                (
                    global_artist_uid,
                    canonical_name,
                    sort_name,
                    normalized_name,
                    musicbrainz_artist_mbid,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_photo,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :canonical_name,
                    :sort_name,
                    :normalized_name,
                    :musicbrainz_artist_mbid,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    false,
                    true,
                    :has_photo,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            """
        ),
        {
            "global_uid": global_uid,
            "canonical_name": payload["canonical_name"],
            "sort_name": payload["sort_name"],
            "normalized_name": payload["normalized_name"],
            "musicbrainz_artist_mbid": payload["musicbrainz_artist_mbid"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": False, "remote": True}),
            "match_json": _json(_match_ref(source)),
            "has_photo": payload["has_photo"],
            "search_text": payload["canonical_name"],
        },
    )


def _upsert_remote_album(
    session,
    source: dict[str, Any],
    global_uid: str,
    artist_uid: str,
) -> None:
    payload = source["source_payload"]
    if _canonical_exists(
        session, "global_catalog_albums", "global_album_uid", global_uid
    ):
        session.execute(
            text(
                """
                UPDATE global_catalog_albums
                SET
                    has_remote = true,
                    has_cover = global_catalog_albums.has_cover OR :has_cover,
                    artwork_source_json = CASE
                        WHEN :has_cover THEN :artwork_source_json
                        ELSE artwork_source_json
                    END,
                    updated_at = NOW()
                WHERE global_album_uid = :global_uid
                """
            ),
            {
                "global_uid": global_uid,
                "has_cover": payload["has_cover"],
                "artwork_source_json": _json(_source_ref(source)),
            },
        )
        return

    session.execute(
        text(
            """
            INSERT INTO global_catalog_albums
                (
                    global_album_uid,
                    global_artist_uid,
                    canonical_name,
                    normalized_name,
                    artist_name,
                    year,
                    release_date,
                    track_count,
                    total_duration_seconds,
                    musicbrainz_release_group_mbid,
                    musicbrainz_release_mbid,
                    upc,
                    display_source_json,
                    artwork_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_cover,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :artist_uid,
                    :canonical_name,
                    :normalized_name,
                    :artist_name,
                    :year,
                    :release_date,
                    :track_count,
                    :total_duration_seconds,
                    :musicbrainz_release_group_mbid,
                    :musicbrainz_release_mbid,
                    :upc,
                    :display_source_json,
                    :artwork_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    false,
                    true,
                    :has_cover,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            """
        ),
        {
            "global_uid": global_uid,
            "artist_uid": artist_uid,
            "canonical_name": payload["canonical_name"],
            "normalized_name": payload["normalized_name"],
            "artist_name": payload["artist_name"],
            "year": payload["year"],
            "release_date": payload["release_date"],
            "track_count": payload["track_count"],
            "total_duration_seconds": payload["total_duration_seconds"],
            "musicbrainz_release_group_mbid": payload["musicbrainz_release_group_mbid"],
            "musicbrainz_release_mbid": payload["musicbrainz_release_mbid"],
            "upc": payload["upc"],
            "display_source_json": _json(_source_ref(source)),
            "artwork_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": False, "remote": True}),
            "match_json": _json(_match_ref(source)),
            "has_cover": payload["has_cover"],
            "search_text": f"{payload['artist_name']} {payload['canonical_name']}",
        },
    )


def _upsert_remote_track(
    session,
    source: dict[str, Any],
    global_uid: str,
    artist_uid: str,
    album_uid: str | None,
) -> None:
    payload = source["source_payload"]
    if _canonical_exists(
        session, "global_catalog_tracks", "global_track_uid", global_uid
    ):
        session.execute(
            text(
                """
                UPDATE global_catalog_tracks
                SET has_remote = true, updated_at = NOW()
                WHERE global_track_uid = :global_uid
                """
            ),
            {"global_uid": global_uid},
        )
        return

    session.execute(
        text(
            """
            INSERT INTO global_catalog_tracks
                (
                    global_track_uid,
                    global_album_uid,
                    global_artist_uid,
                    canonical_title,
                    normalized_title,
                    artist_name,
                    album_name,
                    disc_number,
                    track_number,
                    duration_seconds,
                    musicbrainz_recording_mbid,
                    isrc,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :album_uid,
                    :artist_uid,
                    :canonical_title,
                    :normalized_title,
                    :artist_name,
                    :album_name,
                    :disc_number,
                    :track_number,
                    :duration_seconds,
                    :musicbrainz_recording_mbid,
                    :isrc,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    false,
                    true,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            """
        ),
        {
            "global_uid": global_uid,
            "album_uid": album_uid,
            "artist_uid": artist_uid,
            "canonical_title": payload["canonical_title"],
            "normalized_title": payload["normalized_title"],
            "artist_name": payload["artist_name"],
            "album_name": payload["album_name"],
            "disc_number": payload["disc_number"],
            "track_number": payload["track_number"],
            "duration_seconds": payload["duration_seconds"],
            "musicbrainz_recording_mbid": payload["musicbrainz_recording_mbid"],
            "isrc": payload["isrc"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": False, "remote": True}),
            "match_json": _json(_match_ref(source)),
            "search_text": (
                f"{payload['artist_name']} {payload['album_name']} "
                f"{payload['canonical_title']}"
            ),
        },
    )


def _upsert_source(
    session,
    source: dict[str, Any],
    global_entity_uid: str,
    *,
    preferred: bool,
) -> int:
    conflict_target = _source_conflict_target(source)

    return session.execute(
        text(
            f"""
            INSERT INTO global_catalog_sources
                (
                    entity_type,
                    global_entity_uid,
                    source_kind,
                    node_uid,
                    remote_entity_uid,
                    local_id,
                    local_entity_uid,
                    source_revision,
                    source_deleted_at,
                    source_stale,
                    source_payload_json,
                    match_key,
                    match_confidence,
                    match_method,
                    preferred_for_display,
                    preferred_for_artwork,
                    preferred_for_playback,
                    updated_at
                )
            VALUES
                (
                    :entity_type,
                    :global_entity_uid,
                    :source_kind,
                    :node_uid,
                    :remote_entity_uid,
                    :local_id,
                    :local_entity_uid,
                    :source_revision,
                    :source_deleted_at,
                    :source_stale,
                    :source_payload_json,
                    :match_key,
                    :match_confidence,
                    :match_method,
                    :preferred,
                    :preferred,
                    :preferred,
                    NOW()
                )
            ON CONFLICT {conflict_target} DO UPDATE SET
                global_entity_uid = EXCLUDED.global_entity_uid,
                source_revision = EXCLUDED.source_revision,
                source_deleted_at = EXCLUDED.source_deleted_at,
                source_stale = EXCLUDED.source_stale,
                source_payload_json = EXCLUDED.source_payload_json,
                match_key = EXCLUDED.match_key,
                match_confidence = EXCLUDED.match_confidence,
                match_method = EXCLUDED.match_method,
                preferred_for_display = EXCLUDED.preferred_for_display,
                preferred_for_artwork = EXCLUDED.preferred_for_artwork,
                preferred_for_playback = EXCLUDED.preferred_for_playback,
                updated_at = NOW()
            RETURNING id
            """
        ),
        {
            "entity_type": source["entity_type"],
            "global_entity_uid": global_entity_uid,
            "source_kind": source["source_kind"],
            "node_uid": source["node_uid"],
            "remote_entity_uid": source["remote_entity_uid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "source_revision": source["source_revision"],
            "source_deleted_at": source["source_deleted_at"],
            "source_stale": source["source_stale"],
            "source_payload_json": _json(source["source_payload"]),
            "match_key": source["match_key"],
            "match_confidence": source["match_confidence"],
            "match_method": source["match_method"],
            "preferred": preferred,
        },
    ).scalar_one()


def _project_source_genres(
    session,
    source: dict[str, Any],
    global_entity_uid: str,
    source_id: int,
) -> None:
    from crate.federation.global_genres import project_source_genre_assertions

    payload = source["source_payload"]
    project_source_genre_assertions(
        session,
        source_id=source_id,
        entity_type=source["entity_type"],
        global_entity_uid=global_entity_uid,
        source_kind=source["source_kind"],
        source_revision=source.get("source_revision"),
        assertions=payload.get("genre_assertions") or payload.get("genres") or [],
    )


def _find_artist_uid(session, artist_name: str) -> str | None:
    normalized_name = normalize_name(artist_name)
    row = (
        session.execute(
            text(
                """
                SELECT global_artist_uid::text AS global_artist_uid
                FROM global_catalog_artists
                WHERE normalized_name = :normalized_name
                ORDER BY has_local DESC, source_count DESC, canonical_name ASC
                LIMIT 1
                """
            ),
            {"normalized_name": normalized_name},
        )
        .mappings()
        .first()
    )
    return row["global_artist_uid"] if row else None


def _find_album_uid(session, *, artist_name: str, album_name: str | None) -> str | None:
    if not album_name:
        return None
    normalized_name = normalize_name(album_name, strip_edition=True)
    row = (
        session.execute(
            text(
                """
                SELECT global_album_uid::text AS global_album_uid
                FROM global_catalog_albums
                WHERE normalized_name = :normalized_name
                  AND artist_name = :artist_name
                ORDER BY has_local DESC, source_count DESC, canonical_name ASC
                LIMIT 1
                """
            ),
            {"normalized_name": normalized_name, "artist_name": artist_name},
        )
        .mappings()
        .first()
    )
    return row["global_album_uid"] if row else None


def _source_conflict_target(source: dict[str, Any]) -> str:
    if source["source_kind"] == "federated":
        return (
            "(node_uid, entity_type, remote_entity_uid) WHERE source_kind = 'federated'"
        )
    if not source.get("local_entity_uid"):
        return (
            "(entity_type, local_id) "
            "WHERE source_kind = 'local' AND local_id IS NOT NULL"
        )
    return (
        "(entity_type, local_entity_uid) "
        "WHERE source_kind = 'local' AND local_entity_uid IS NOT NULL"
    )


def _canonical_has_local(session, entity_type: str, global_uid: str) -> bool:
    table_name, id_column = _canonical_table(entity_type)
    row = session.execute(
        text(f"SELECT has_local FROM {table_name} WHERE {id_column} = :global_uid"),
        {"global_uid": global_uid},
    ).first()
    return bool(row[0]) if row else False


def _refresh_source_count(session, entity_type: str, global_uid: str) -> None:
    table_name, id_column = _canonical_table(entity_type)
    session.execute(
        text(
            f"""
            UPDATE {table_name}
            SET
                source_count = counts.source_count,
                has_local = counts.has_local,
                has_remote = counts.has_remote,
                updated_at = NOW()
            FROM (
                SELECT
                    COUNT(*)::integer AS source_count,
                    COALESCE(BOOL_OR(source_kind = 'local'), false) AS has_local,
                    COALESCE(BOOL_OR(source_kind = 'federated'), false) AS has_remote
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND global_entity_uid = :global_uid
                  AND source_deleted_at IS NULL
                  AND NOT source_stale
            ) AS counts
            WHERE {id_column} = :global_uid
            """
        ),
        {"entity_type": entity_type, "global_uid": global_uid},
    )


def _refresh_artist_has_photo(session, global_uid: str) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_artists
            SET has_photo = COALESCE(photo_sources.has_photo, false),
                updated_at = NOW()
            FROM (
                SELECT BOOL_OR(
                    COALESCE(
                        (source_payload_json->>'has_photo')::boolean,
                        ((source_payload_json->'facets'->'artist_photo'->>'available')::boolean),
                        false
                    )
                ) AS has_photo
                FROM global_catalog_sources
                WHERE entity_type = 'artist'
                  AND global_entity_uid = :global_uid
                  AND NOT source_stale
                  AND source_deleted_at IS NULL
            ) AS photo_sources
            WHERE global_artist_uid = :global_uid
            """
        ),
        {"global_uid": global_uid},
    )


def _canonical_table(entity_type: str) -> tuple[str, str]:
    if entity_type == "artist":
        return "global_catalog_artists", "global_artist_uid"
    if entity_type == "album":
        return "global_catalog_albums", "global_album_uid"
    if entity_type == "track":
        return "global_catalog_tracks", "global_track_uid"
    raise ValueError(f"Unsupported entity type: {entity_type}")


def _source_ref(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_kind": source["source_kind"],
        "node_uid": source["node_uid"],
        "remote_entity_uid": source["remote_entity_uid"],
        "local_id": source["local_id"],
        "local_entity_uid": source["local_entity_uid"],
    }


def _match_ref(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "match_key": source["match_key"],
        "confidence": source["match_confidence"],
        "method": source["match_method"],
    }


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True)


__all__ = ["reconcile_local_catalog", "reconcile_remote_catalog"]
