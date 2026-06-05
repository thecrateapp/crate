from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from crate.db.queries.browse_media_track_genres import (
    get_track_album_genres,
    get_track_artist_genres,
)
from crate.db.repositories.equalizer_presets import (
    EqualizerPresetRecord,
    TrackEqualizerContext,
    delete_equalizer_preset,
    get_album_equalizer_context,
    get_equalizer_preset,
    get_track_equalizer_context,
    normalize_eq_gains,
    upsert_equalizer_preset,
)
from crate.genre_taxonomy import (
    get_genre_display_name,
    get_top_level_slug,
    is_canonical_genre_slug,
    resolve_genre_eq_preset,
    resolve_genre_slug,
)

FLAT_EQ_GAINS = [0.0] * 10


@dataclass(frozen=True)
class EffectiveEqualizerResult:
    track_id: int
    track_entity_uid: str | None
    album_id: int | None
    album_entity_uid: str | None
    gains: list[float]
    source: str
    label: str
    reasoning: str
    scope: str | None = None
    target_type: str | None = None
    target_entity_uid: str | None = None
    user_id: int | None = None
    genre: dict[str, Any] | None = None
    inherited_from: dict[str, str] | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "trackId": self.track_id,
            "trackEntityUid": self.track_entity_uid,
            "albumId": self.album_id,
            "albumEntityUid": self.album_entity_uid,
            "gains": self.gains,
            "source": self.source,
            "label": self.label,
            "reasoning": self.reasoning,
            "scope": self.scope,
            "targetType": self.target_type,
            "targetEntityUid": self.target_entity_uid,
            "userId": self.user_id,
            "genre": self.genre,
            "inheritedFrom": self.inherited_from,
        }


def compute_audio_analysis_gains(context: TrackEqualizerContext | None) -> list[float]:
    if context is None or not _has_audio_analysis_features(context):
        return list(FLAT_EQ_GAINS)

    gains = [0.0] * 10

    def add(index: int, value: float) -> None:
        gains[index] += value

    dynamic_range_scale = 0.35 if _gt(context.dynamic_range, 14) else 1.0

    brightness = context.spectral_complexity
    if brightness is not None:
        if brightness < 0.25:
            add(7, 1.5)
            add(8, 2.0)
            add(9, 1.5)
        elif brightness < 0.4:
            add(8, 1.0)
        elif brightness > 0.7:
            add(7, -1.5)
            add(8, -2.0)
        elif brightness > 0.55:
            add(8, -1.0)

    energy = context.energy
    if energy is not None:
        if energy > 0.7:
            add(0, 1.0)
            add(1, 1.5)
            add(4, -0.5)
        elif energy < 0.3:
            add(3, 1.0)

    loudness = context.loudness
    if loudness is not None:
        if loudness > -10:
            add(5, -0.5)
            add(6, -0.5)
        elif loudness < -20:
            add(4, 0.5)
            add(5, 0.5)

    if context.dynamic_range is not None and context.dynamic_range < 6:
        add(1, 0.5)
        add(8, 0.5)

    if context.acousticness is not None and context.acousticness > 0.6:
        add(3, 1.0)
        add(7, -0.5)

    return [
        0.0
        if abs(scaled := gain * dynamic_range_scale) < 0.05
        else max(-4.0, min(4.0, round(scaled, 2)))
        for gain in gains
    ]


def resolve_effective_track_eq(
    track_id: int, *, user_id: int | None = None
) -> EffectiveEqualizerResult | None:
    context = get_track_equalizer_context(track_id)
    if context is None:
        return None

    if context.track_entity_uid and user_id is not None:
        preset = get_equalizer_preset(
            scope="user",
            target_type="track",
            target_entity_uid=context.track_entity_uid,
            user_id=user_id,
        )
        if preset is not None:
            return _preset_result(
                context,
                preset,
                source="user_track_preset",
                default_label="Your track preset",
            )

    if context.track_entity_uid:
        preset = get_equalizer_preset(
            scope="instance",
            target_type="track",
            target_entity_uid=context.track_entity_uid,
        )
        if preset is not None:
            return _preset_result(
                context,
                preset,
                source="instance_track_preset",
                default_label="Curator track preset",
            )

    if context.album_entity_uid:
        preset = get_equalizer_preset(
            scope="instance",
            target_type="album",
            target_entity_uid=context.album_entity_uid,
        )
        if preset is not None:
            return _preset_result(
                context,
                preset,
                source="instance_album_preset",
                default_label="Curator album preset",
            )

    genre_result = _resolve_genre_eq(context)
    if genre_result is not None:
        return genre_result

    if _has_audio_analysis_features(context):
        return EffectiveEqualizerResult(
            track_id=context.track_id,
            track_entity_uid=context.track_entity_uid,
            album_id=context.album_id,
            album_entity_uid=context.album_entity_uid,
            gains=compute_audio_analysis_gains(context),
            source="audio_analysis_preset",
            label="Audio analysis",
            reasoning="Generated from the track analysis profile.",
        )

    return EffectiveEqualizerResult(
        track_id=context.track_id,
        track_entity_uid=context.track_entity_uid,
        album_id=context.album_id,
        album_entity_uid=context.album_entity_uid,
        gains=list(FLAT_EQ_GAINS),
        source="flat",
        label="Flat",
        reasoning="No preset, genre EQ, or usable analysis data was available.",
    )


def save_user_track_eq_preset(
    track_id: int,
    *,
    user_id: int,
    gains: list[float],
    label: str = "",
    reasoning: str = "",
    created_by: int | None = None,
) -> EffectiveEqualizerResult | None:
    context = get_track_equalizer_context(track_id)
    if context is None:
        return None
    if not context.track_entity_uid:
        raise ValueError("Track does not have an entity UID")
    preset = upsert_equalizer_preset(
        scope="user",
        target_type="track",
        target_entity_uid=context.track_entity_uid,
        user_id=user_id,
        gains=gains,
        label=label,
        reasoning=reasoning,
        source="manual",
        created_by=created_by or user_id,
    )
    return _preset_result(
        context,
        preset,
        source="user_track_preset",
        default_label="Your track preset",
    )


def clear_user_track_eq_preset(track_id: int, *, user_id: int) -> bool | None:
    context = get_track_equalizer_context(track_id)
    if context is None:
        return None
    if not context.track_entity_uid:
        return False
    return delete_equalizer_preset(
        scope="user",
        target_type="track",
        target_entity_uid=context.track_entity_uid,
        user_id=user_id,
    )


def save_instance_track_eq_preset(
    track_id: int,
    *,
    gains: list[float],
    label: str = "",
    reasoning: str = "",
    created_by: int | None = None,
) -> EffectiveEqualizerResult | None:
    context = get_track_equalizer_context(track_id)
    if context is None:
        return None
    if not context.track_entity_uid:
        raise ValueError("Track does not have an entity UID")
    preset = upsert_equalizer_preset(
        scope="instance",
        target_type="track",
        target_entity_uid=context.track_entity_uid,
        gains=gains,
        label=label,
        reasoning=reasoning,
        source="manual",
        created_by=created_by,
    )
    return _preset_result(
        context,
        preset,
        source="instance_track_preset",
        default_label="Curator track preset",
    )


def clear_instance_track_eq_preset(track_id: int) -> bool | None:
    context = get_track_equalizer_context(track_id)
    if context is None:
        return None
    if not context.track_entity_uid:
        return False
    return delete_equalizer_preset(
        scope="instance",
        target_type="track",
        target_entity_uid=context.track_entity_uid,
    )


def save_instance_album_eq_preset(
    album_id: int,
    *,
    gains: list[float],
    label: str = "",
    reasoning: str = "",
    created_by: int | None = None,
) -> dict[str, Any] | None:
    context = get_album_equalizer_context(album_id)
    if context is None:
        return None
    if not context.album_entity_uid:
        raise ValueError("Album does not have an entity UID")
    preset = upsert_equalizer_preset(
        scope="instance",
        target_type="album",
        target_entity_uid=context.album_entity_uid,
        gains=gains,
        label=label,
        reasoning=reasoning,
        source="manual",
        created_by=created_by,
    )
    return {
        "albumId": context.album_id,
        "albumEntityUid": context.album_entity_uid,
        "artist": context.artist,
        "album": context.name,
        "preset": _preset_payload(preset),
    }


def clear_instance_album_eq_preset(album_id: int) -> bool | None:
    context = get_album_equalizer_context(album_id)
    if context is None:
        return None
    if not context.album_entity_uid:
        return False
    return delete_equalizer_preset(
        scope="instance",
        target_type="album",
        target_entity_uid=context.album_entity_uid,
    )


def _preset_result(
    context: TrackEqualizerContext,
    preset: EqualizerPresetRecord,
    *,
    source: str,
    default_label: str,
) -> EffectiveEqualizerResult:
    return EffectiveEqualizerResult(
        track_id=context.track_id,
        track_entity_uid=context.track_entity_uid,
        album_id=context.album_id,
        album_entity_uid=context.album_entity_uid,
        gains=preset.gains,
        source=source,
        label=preset.label or default_label,
        reasoning=preset.reasoning,
        scope=preset.scope,
        target_type=preset.target_type,
        target_entity_uid=preset.target_entity_uid,
        user_id=preset.user_id,
    )


def _preset_payload(preset: EqualizerPresetRecord) -> dict[str, Any]:
    return {
        "id": preset.id,
        "scope": preset.scope,
        "targetType": preset.target_type,
        "targetEntityUid": preset.target_entity_uid,
        "userId": preset.user_id,
        "gains": preset.gains,
        "label": preset.label,
        "reasoning": preset.reasoning,
        "source": preset.source,
        "createdBy": preset.created_by,
    }


def _resolve_genre_eq(
    context: TrackEqualizerContext,
) -> EffectiveEqualizerResult | None:
    picked = _pick_track_primary_genre(context.track_id)
    if picked is None:
        return None
    preset = picked.get("preset")
    if not preset:
        return None
    primary = picked.get("primary")
    return EffectiveEqualizerResult(
        track_id=context.track_id,
        track_entity_uid=context.track_entity_uid,
        album_id=context.album_id,
        album_entity_uid=context.album_entity_uid,
        gains=normalize_eq_gains(preset["gains"]),
        source="genre_taxonomy_preset",
        label=f"Genre: {primary.get('name')}" if primary else "Genre preset",
        reasoning=(
            "Inherited from the genre taxonomy."
            if preset.get("source") == "inherited"
            else "Defined on the primary genre."
        ),
        genre=primary,
        inherited_from=preset.get("inheritedFrom"),
    )


def _pick_track_primary_genre(track_id: int) -> dict[str, Any] | None:
    album_rows = get_track_album_genres(track_id)
    picked = _pick_primary_genre(album_rows, canonical_only=True)
    if picked is not None:
        picked["source"] = "album"
        return picked
    artist_rows = get_track_artist_genres(track_id)
    picked = _pick_primary_genre(artist_rows, canonical_only=True)
    if picked is not None:
        picked["source"] = "artist"
        return picked
    return None


def _pick_primary_genre(rows, *, canonical_only: bool) -> dict[str, Any] | None:
    for row in rows or []:
        raw_slug = (row.get("slug") or "").strip().lower()
        raw_name = (row.get("name") or "").strip().lower()
        resolved = resolve_genre_slug(raw_name or raw_slug)
        if not resolved or not is_canonical_genre_slug(resolved):
            if canonical_only:
                continue
            return {
                "primary": {
                    "slug": raw_slug or resolved or "",
                    "name": raw_name
                    or (raw_slug.replace("-", " ") if raw_slug else ""),
                    "canonical": False,
                },
                "topLevel": None,
                "preset": None,
            }

        top_level_slug = get_top_level_slug(resolved) or resolved
        preset_info = resolve_genre_eq_preset(resolved)
        preset_payload = None
        if preset_info is not None:
            preset_payload = {
                "gains": preset_info["gains"],
                "source": preset_info["source"],
                "inheritedFrom": (
                    {"slug": preset_info["slug"], "name": preset_info["name"]}
                    if preset_info["source"] == "inherited"
                    else None
                ),
            }
        return {
            "primary": {
                "slug": resolved,
                "name": get_genre_display_name(resolved),
                "canonical": True,
            },
            "topLevel": {
                "slug": top_level_slug,
                "name": get_genre_display_name(top_level_slug),
            },
            "preset": preset_payload,
        }
    return None


def _has_audio_analysis_features(context: TrackEqualizerContext) -> bool:
    return any(
        value is not None
        for value in (
            context.energy,
            context.loudness,
            context.dynamic_range,
            context.spectral_complexity,
            context.danceability,
            context.valence,
            context.acousticness,
            context.instrumentalness,
        )
    )


def _gt(value: float | None, threshold: float) -> bool:
    return value is not None and value > threshold


__all__ = [
    "EffectiveEqualizerResult",
    "clear_instance_album_eq_preset",
    "clear_instance_track_eq_preset",
    "clear_user_track_eq_preset",
    "compute_audio_analysis_gains",
    "resolve_effective_track_eq",
    "save_instance_album_eq_preset",
    "save_instance_track_eq_preset",
    "save_user_track_eq_preset",
]
