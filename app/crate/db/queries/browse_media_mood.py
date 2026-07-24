from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope

_MOOD_COLUMNS = {
    "acousticness",
    "bpm",
    "danceability",
    "energy",
    "instrumentalness",
    "valence",
}


def _convert_mood_params(conditions: list[str], params: list) -> tuple[list[str], dict]:
    named_conditions = []
    named_params = {}
    param_idx = 0
    for cond in conditions:
        if "%s" in cond:
            param_name = f"p{param_idx}"
            named_conditions.append(cond.replace("%s", f":{param_name}", 1))
            named_params[param_name] = params[param_idx]
            param_idx += 1
        else:
            named_conditions.append(cond)
    return named_conditions, named_params


def _mood_filter_expression(
    filters: Mapping[str, Any], prefix: str
) -> tuple[str, dict[str, Any]]:
    clauses = ["bpm IS NOT NULL"]
    params: dict[str, Any] = {}
    for index, (key, value) in enumerate(filters.items()):
        try:
            column, suffix = key.rsplit("_", 1)
        except ValueError as exc:
            raise ValueError(f"Invalid mood filter: {key}") from exc
        if column not in _MOOD_COLUMNS or suffix not in {"min", "max"}:
            raise ValueError(f"Invalid mood filter: {key}")
        param_name = f"{prefix}_{index}"
        operator = ">=" if suffix == "min" else "<="
        clauses.append(f"{column} {operator} :{param_name}")
        params[param_name] = value
    return " AND ".join(clauses), params


def count_mood_tracks(conditions: list[str], params: list) -> int:
    # conditions originate from _mood_filter_expression which validates
    # column names against _MOOD_COLUMNS whitelist; values use SQL params.
    named_conditions, named_params = _convert_mood_params(conditions, params)
    return _count_global_mood_tracks(named_conditions, named_params)


def count_mood_presets(presets: Mapping[str, Mapping[str, Any]]) -> dict[str, int]:
    if not presets:
        return {}

    select_parts: list[str] = []
    params: dict[str, Any] = {}
    aliases: dict[str, str] = {}
    for index, (name, filters) in enumerate(presets.items()):
        alias = f"mood_{index}"
        expression, expression_params = _mood_filter_expression(filters, alias)
        select_parts.append(f"COUNT(*) FILTER (WHERE {expression}) AS {alias}")
        params.update(expression_params)
        aliases[name] = alias

    return _count_global_mood_presets(select_parts, params, aliases)


def get_mood_tracks(conditions: list[str], params: list, limit: int) -> list[dict]:
    # conditions originate from _mood_filter_expression which validates
    # column names against _MOOD_COLUMNS whitelist; values use SQL params.
    named_conditions, named_params = _convert_mood_params(conditions, params)
    named_params["limit"] = limit
    return _get_global_mood_tracks(named_conditions, named_params)


_GLOBAL_MOOD_TRACKS_CTE = """
WITH remote_track_sources AS (
    SELECT DISTINCT ON (global_entity_uid)
        global_entity_uid,
        node_uid::text AS node_uid,
        remote_entity_uid,
        source_payload_json
    FROM global_catalog_sources
    WHERE entity_type = 'track'
      AND source_kind = 'federated'
      AND source_deleted_at IS NULL
      AND source_stale = false
    ORDER BY
        global_entity_uid,
        preferred_for_playback DESC,
        preferred_for_display DESC,
        updated_at DESC
),
global_mood_tracks AS (
    SELECT
        gt.local_track_id AS id,
        gt.global_track_uid::text AS global_track_uid,
        gt.global_artist_uid::text AS global_artist_uid,
        gt.global_album_uid::text AS global_album_uid,
        COALESCE(gt.local_track_entity_uid::text, gt.global_track_uid::text) AS entity_uid,
        gt.local_track_entity_uid::text AS track_entity_uid,
        gt.canonical_title AS title,
        gt.artist_name AS artist,
        ga.local_artist_id AS artist_id,
        ga.local_artist_entity_uid::text AS artist_entity_uid,
        la.slug AS artist_slug,
        gt.album_name AS album,
        gal.local_album_id AS album_id,
        gal.local_album_entity_uid::text AS album_entity_uid,
        lal.slug AS album_slug,
        lt.path,
        gt.duration_seconds AS duration,
        COALESCE(taf.bpm, lt.bpm, NULLIF(remote.source_payload_json->>'bpm', '')::double precision) AS bpm,
        COALESCE(taf.energy, lt.energy, NULLIF(remote.source_payload_json->>'energy', '')::double precision) AS energy,
        COALESCE(taf.danceability, lt.danceability, NULLIF(remote.source_payload_json->>'danceability', '')::double precision) AS danceability,
        COALESCE(taf.valence, lt.valence, NULLIF(remote.source_payload_json->>'valence', '')::double precision) AS valence,
        COALESCE(taf.acousticness, lt.acousticness, NULLIF(remote.source_payload_json->>'acousticness', '')::double precision) AS acousticness,
        COALESCE(taf.instrumentalness, lt.instrumentalness, NULLIF(remote.source_payload_json->>'instrumentalness', '')::double precision) AS instrumentalness,
        CASE
            WHEN gt.has_local THEN 'local'
            WHEN remote.node_uid IS NOT NULL THEN 'remote'
            ELSE NULL
        END AS origin,
        remote.node_uid,
        remote.remote_entity_uid,
        gt.availability_json AS availability
    FROM global_catalog_tracks gt
    LEFT JOIN library_tracks lt
      ON lt.id = gt.local_track_id
    LEFT JOIN track_analysis_features taf
      ON taf.track_id = lt.id
    LEFT JOIN global_catalog_artists ga
      ON ga.global_artist_uid = gt.global_artist_uid
    LEFT JOIN library_artists la
      ON la.id = ga.local_artist_id
    LEFT JOIN global_catalog_albums gal
      ON gal.global_album_uid = gt.global_album_uid
    LEFT JOIN library_albums lal
      ON lal.id = gal.local_album_id
    LEFT JOIN remote_track_sources remote
      ON remote.global_entity_uid = gt.global_track_uid
    WHERE gt.has_local OR gt.has_remote
)
"""


def _count_global_mood_tracks(conditions: list[str], params: dict[str, Any]) -> int:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    _GLOBAL_MOOD_TRACKS_CTE
                    + "SELECT COUNT(*) AS cnt FROM global_mood_tracks WHERE "
                    + " AND ".join(conditions)
                ),
                params,
            )
            .mappings()
            .first()
        )
        return int(row["cnt"] or 0) if row is not None else 0


def _count_global_mood_presets(
    select_parts: list[str],
    params: dict[str, Any],
    aliases: dict[str, str],
) -> dict[str, int]:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    _GLOBAL_MOOD_TRACKS_CTE
                    + "SELECT "
                    + ", ".join(select_parts)
                    + " FROM global_mood_tracks WHERE bpm IS NOT NULL"
                ),
                params,
            )
            .mappings()
            .first()
        )

    counts = dict(row or {})
    return {name: int(counts.get(alias) or 0) for name, alias in aliases.items()}


def _get_global_mood_tracks(
    conditions: list[str], params: dict[str, Any]
) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    _GLOBAL_MOOD_TRACKS_CTE
                    + """
                    SELECT
                        id,
                        global_track_uid,
                        global_artist_uid,
                        global_album_uid,
                        entity_uid,
                        track_entity_uid,
                        title,
                        artist,
                        artist_id,
                        artist_entity_uid,
                        artist_slug,
                        COALESCE(album, '') AS album,
                        album_id,
                        album_entity_uid,
                        album_slug,
                        path,
                        duration,
                        bpm,
                        energy,
                        danceability,
                        valence,
                        origin,
                        node_uid,
                        remote_entity_uid,
                        availability
                    FROM global_mood_tracks
                    WHERE """
                    + " AND ".join(conditions)
                    + """
                    ORDER BY RANDOM()
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


__all__ = [
    "count_mood_presets",
    "count_mood_tracks",
    "get_mood_tracks",
]
