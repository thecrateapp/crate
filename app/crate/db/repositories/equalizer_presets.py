from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
import math
from typing import Any, Sequence

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope

EQ_BAND_COUNT = 10
EQ_GAIN_MIN = -12.0
EQ_GAIN_MAX = 12.0

VALID_EQ_SCOPES = {"user", "instance"}
VALID_EQ_TARGET_TYPES = {"track", "album"}


@dataclass(frozen=True)
class EqualizerPresetRecord:
    id: int
    scope: str
    target_type: str
    target_entity_uid: str
    user_id: int | None
    gains: list[float]
    label: str
    reasoning: str
    source: str
    created_by: int | None


@dataclass(frozen=True)
class TrackEqualizerContext:
    track_id: int
    track_entity_uid: str | None
    album_id: int | None
    album_entity_uid: str | None
    title: str | None
    artist: str | None
    album: str | None
    energy: float | None
    loudness: float | None
    dynamic_range: float | None
    spectral_complexity: float | None
    danceability: float | None
    valence: float | None
    acousticness: float | None
    instrumentalness: float | None


@dataclass(frozen=True)
class AlbumEqualizerContext:
    album_id: int
    album_entity_uid: str | None
    name: str
    artist: str


def normalize_eq_gains(gains: Sequence[Any]) -> list[float]:
    if len(gains) != EQ_BAND_COUNT:
        raise ValueError(f"EQ preset must contain {EQ_BAND_COUNT} bands")

    normalized: list[float] = []
    for raw in gains:
        try:
            value = float(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("EQ gains must be numeric") from exc
        if not math.isfinite(value):
            raise ValueError("EQ gains must be finite")
        clamped = max(EQ_GAIN_MIN, min(EQ_GAIN_MAX, value))
        normalized.append(round(clamped, 2))
    return normalized


def _normalize_scope(scope: str) -> str:
    normalized = (scope or "").strip().lower()
    if normalized not in VALID_EQ_SCOPES:
        raise ValueError(f"Unsupported EQ preset scope: {scope}")
    return normalized


def _normalize_target_type(target_type: str) -> str:
    normalized = (target_type or "").strip().lower()
    if normalized not in VALID_EQ_TARGET_TYPES:
        raise ValueError(f"Unsupported EQ preset target type: {target_type}")
    return normalized


def _serialize_preset(row) -> EqualizerPresetRecord | None:
    if not row:
        return None
    return EqualizerPresetRecord(
        id=int(row["id"]),
        scope=str(row["scope"]),
        target_type=str(row["target_type"]),
        target_entity_uid=str(row["target_entity_uid"]),
        user_id=int(row["user_id"]) if row.get("user_id") is not None else None,
        gains=normalize_eq_gains(row["gains"] or []),
        label=str(row.get("label") or ""),
        reasoning=str(row.get("reasoning") or ""),
        source=str(row.get("source") or "manual"),
        created_by=int(row["created_by"])
        if row.get("created_by") is not None
        else None,
    )


def get_track_equalizer_context(
    track_id: int, *, session=None
) -> TrackEqualizerContext | None:
    manager = nullcontext(session) if session is not None else read_scope()
    with manager as s:
        row = (
            s.execute(
                text(
                    """
                    SELECT
                        t.id,
                        t.entity_uid::text AS track_entity_uid,
                        t.album_id,
                        a.entity_uid::text AS album_entity_uid,
                        t.title,
                        t.artist,
                        t.album,
                        t.energy,
                        t.loudness,
                        t.dynamic_range,
                        t.spectral_complexity,
                        t.danceability,
                        t.valence,
                        t.acousticness,
                        t.instrumentalness
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON a.id = t.album_id
                    WHERE t.id = :track_id
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return TrackEqualizerContext(
        track_id=int(row["id"]),
        track_entity_uid=row.get("track_entity_uid"),
        album_id=int(row["album_id"]) if row.get("album_id") is not None else None,
        album_entity_uid=row.get("album_entity_uid"),
        title=row.get("title"),
        artist=row.get("artist"),
        album=row.get("album"),
        energy=row.get("energy"),
        loudness=row.get("loudness"),
        dynamic_range=row.get("dynamic_range"),
        spectral_complexity=row.get("spectral_complexity"),
        danceability=row.get("danceability"),
        valence=row.get("valence"),
        acousticness=row.get("acousticness"),
        instrumentalness=row.get("instrumentalness"),
    )


def get_album_equalizer_context(
    album_id: int, *, session=None
) -> AlbumEqualizerContext | None:
    manager = nullcontext(session) if session is not None else read_scope()
    with manager as s:
        row = (
            s.execute(
                text(
                    """
                    SELECT id, entity_uid::text AS album_entity_uid, name, artist
                    FROM library_albums
                    WHERE id = :album_id
                    """
                ),
                {"album_id": album_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return AlbumEqualizerContext(
        album_id=int(row["id"]),
        album_entity_uid=row.get("album_entity_uid"),
        name=str(row["name"]),
        artist=str(row["artist"]),
    )


def get_equalizer_preset(
    *,
    scope: str,
    target_type: str,
    target_entity_uid: str,
    user_id: int | None = None,
    session=None,
) -> EqualizerPresetRecord | None:
    scope = _normalize_scope(scope)
    target_type = _normalize_target_type(target_type)
    manager = nullcontext(session) if session is not None else read_scope()
    where = """
        scope = :scope
        AND target_type = :target_type
        AND target_entity_uid = CAST(:target_entity_uid AS UUID)
    """
    params: dict[str, Any] = {
        "scope": scope,
        "target_type": target_type,
        "target_entity_uid": target_entity_uid,
    }
    if scope == "user":
        if user_id is None:
            raise ValueError("user_id is required for user EQ presets")
        where += " AND user_id = :user_id"
        params["user_id"] = user_id
    else:
        where += " AND user_id IS NULL"

    with manager as s:
        row = (
            s.execute(
                text(f"SELECT * FROM equalizer_presets WHERE {where} LIMIT 1"),
                params,
            )
            .mappings()
            .first()
        )
    return _serialize_preset(row)


def upsert_equalizer_preset(
    *,
    scope: str,
    target_type: str,
    target_entity_uid: str,
    gains: Sequence[Any],
    user_id: int | None = None,
    label: str = "",
    reasoning: str = "",
    source: str = "manual",
    created_by: int | None = None,
    session=None,
) -> EqualizerPresetRecord:
    scope = _normalize_scope(scope)
    target_type = _normalize_target_type(target_type)
    normalized_gains = normalize_eq_gains(gains)
    if scope == "user" and user_id is None:
        raise ValueError("user_id is required for user EQ presets")
    if scope == "instance":
        user_id = None

    conflict_target = (
        "(scope, target_type, target_entity_uid, user_id) WHERE scope = 'user'"
        if scope == "user"
        else "(scope, target_type, target_entity_uid) WHERE scope = 'instance'"
    )
    params = {
        "scope": scope,
        "target_type": target_type,
        "target_entity_uid": target_entity_uid,
        "user_id": user_id,
        "gains": normalized_gains,
        "label": (label or "").strip(),
        "reasoning": (reasoning or "").strip(),
        "source": (source or "manual").strip() or "manual",
        "created_by": created_by,
    }

    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    f"""
                    INSERT INTO equalizer_presets (
                        scope,
                        target_type,
                        target_entity_uid,
                        user_id,
                        gains,
                        label,
                        reasoning,
                        source,
                        created_by,
                        updated_at
                    )
                    VALUES (
                        :scope,
                        :target_type,
                        CAST(:target_entity_uid AS UUID),
                        :user_id,
                        :gains,
                        :label,
                        :reasoning,
                        :source,
                        :created_by,
                        NOW()
                    )
                    ON CONFLICT {conflict_target}
                    DO UPDATE SET
                        gains = EXCLUDED.gains,
                        label = EXCLUDED.label,
                        reasoning = EXCLUDED.reasoning,
                        source = EXCLUDED.source,
                        created_by = EXCLUDED.created_by,
                        updated_at = NOW()
                    RETURNING *
                    """
                ),
                params,
            )
            .mappings()
            .one()
        )
    preset = _serialize_preset(row)
    if preset is None:
        raise RuntimeError("Failed to persist EQ preset")
    return preset


def delete_equalizer_preset(
    *,
    scope: str,
    target_type: str,
    target_entity_uid: str,
    user_id: int | None = None,
    session=None,
) -> bool:
    scope = _normalize_scope(scope)
    target_type = _normalize_target_type(target_type)
    if scope == "user" and user_id is None:
        raise ValueError("user_id is required for user EQ presets")

    where = """
        scope = :scope
        AND target_type = :target_type
        AND target_entity_uid = CAST(:target_entity_uid AS UUID)
    """
    params: dict[str, Any] = {
        "scope": scope,
        "target_type": target_type,
        "target_entity_uid": target_entity_uid,
    }
    if scope == "user":
        where += " AND user_id = :user_id"
        params["user_id"] = user_id
    else:
        where += " AND user_id IS NULL"

    with optional_scope(session) as s:
        result = s.execute(
            text(f"DELETE FROM equalizer_presets WHERE {where}"),
            params,
        )
    return int(getattr(result, "rowcount", 0) or 0) > 0


__all__ = [
    "AlbumEqualizerContext",
    "EQ_BAND_COUNT",
    "EQ_GAIN_MAX",
    "EQ_GAIN_MIN",
    "EqualizerPresetRecord",
    "TrackEqualizerContext",
    "delete_equalizer_preset",
    "get_album_equalizer_context",
    "get_equalizer_preset",
    "get_track_equalizer_context",
    "normalize_eq_gains",
    "upsert_equalizer_preset",
]
