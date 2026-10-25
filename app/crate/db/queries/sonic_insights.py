"""Pure, exact sonic regions folded from the worker's resolved local population.

Map coordinates always use current Smart Mix profiles. Legacy acoustic traits
are retained only as secondary estimates, never as replacement measurements.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

from crate.smart_mix.versions import (
    ANALYZER_VERSION,
    MEASUREMENT_VERSION,
    PROFILE_SCHEMA_VERSION,
)


def _finite(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _unit(value: object) -> float | None:
    number = _finite(value)
    return number if number is not None and 0 <= number <= 1 else None


def _nonnegative(value: object) -> float:
    number = _finite(value)
    return number if number is not None and number >= 0 else 0.0


def sonic_track_reading(track: dict) -> dict:
    """Normalize a resolved local row for both snapshots and bounded neighbors.

    ``profile_current`` is established by the query from version, analyzer,
    quality and staleness. Accredited LUFS and true peak require their own
    measurement version as well. Unknowns remain null in the reading.
    """
    current = track.get("profile_current") is True
    measured = current and track.get("mix_measurement_version") == MEASUREMENT_VERSION
    bpm = _finite(track.get("mix_bpm")) if current else None
    key = track.get("mix_key_camelot") if current else None
    if not isinstance(key, str) or not re.fullmatch(r"(?:[1-9]|1[0-2])[AB]", key):
        key = None
    plays = int(_nonnegative(track.get("current_plays")))
    minutes = _nonnegative(track.get("current_minutes"))
    return {
        "id": track["id"],
        "entity_uid": track.get("track_uid"),
        "title": track["track_title"],
        "album_id": track["album_id"],
        "album_entity_uid": track.get("entity_uid"),
        "album": track["title"],
        "album_slug": track.get("slug"),
        "artist": track["artist"],
        "artist_slug": track.get("artist_slug"),
        "year": track.get("year"),
        "has_cover": bool(track.get("has_cover")),
        "heard": plays > 0 or minutes > 0,
        "plays": plays,
        "minutes": minutes,
        "bpm": bpm if bpm is not None and 0 < bpm < 1000 else None,
        "bpm_confidence": _unit(track.get("mix_bpm_confidence")) if current else None,
        "energy": _unit(track.get("mix_energy")) if current else None,
        "integrated_lufs": _finite(track.get("mix_integrated_lufs"))
        if measured
        else None,
        "true_peak_dbfs": _finite(track.get("mix_true_peak_dbfs"))
        if measured
        else None,
        "key_camelot": key,
        "key_confidence": _unit(track.get("mix_key_confidence")) if current else None,
        "tempo_stability": _unit(track.get("mix_tempo_stability")) if current else None,
        "quality": track.get("mix_quality") if current else None,
        "has_bliss": bool(track.get("has_bliss")),
        "acousticness": _unit(track.get("acousticness")),
        "instrumentalness": _unit(track.get("instrumentalness")),
        "valence": _unit(track.get("valence")),
    }


def _examples(tracks: list[dict]) -> list[dict]:
    cohorts = {
        heard: sorted((t for t in tracks if t["heard"] is heard), key=lambda t: t["id"])
        for heard in (True, False)
    }
    chosen: list[dict] = []
    albums: set[int] = set()
    # Prefer a mix of listening cohorts and different albums before filling any
    # remaining slots with more tracks from already represented albums.
    for diverse in (True, False):
        while len(chosen) < 6:
            added = False
            for heard in (True, False):
                candidate = next(
                    (
                        t
                        for t in cohorts[heard]
                        if not diverse or t["album_id"] not in albums
                    ),
                    None,
                )
                if candidate is None:
                    continue
                cohorts[heard].remove(candidate)
                chosen.append(candidate)
                albums.add(candidate["album_id"])
                added = True
                if len(chosen) == 6:
                    break
            if not added:
                break
    return chosen


def _plane(tracks: list[dict], key: str, field: str, x: dict, y: dict) -> dict:
    paired = [t for t in tracks if t["bpm"] is not None and t[field] is not None]
    paired_heard = sum(t["heard"] for t in paired)
    grouped: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for track in paired:
        column = min(
            x["bins"] - 1,
            int((track["bpm"] - x["min"]) / (x["max"] - x["min"]) * x["bins"]),
        )
        row = min(
            y["bins"] - 1,
            int((track[field] - y["min"]) / (y["max"] - y["min"]) * y["bins"]),
        )
        grouped[column, row].append(track)
    cells = []
    for (column, row), group in sorted(grouped.items()):
        heard = [t for t in group if t["heard"]]
        cells.append(
            {
                "id": f"{key}:{column}:{row}",
                "column": column,
                "row": row,
                "x_min": x["min"] + (x["max"] - x["min"]) * column / x["bins"],
                "x_max": x["min"] + (x["max"] - x["min"]) * (column + 1) / x["bins"],
                "y_min": y["min"] + (y["max"] - y["min"]) * row / y["bins"],
                "y_max": y["min"] + (y["max"] - y["min"]) * (row + 1) / y["bins"],
                "tracks": len(group),
                "albums": len({t["album_id"] for t in group}),
                "heard_tracks": len(heard),
                "heard_albums": len({t["album_id"] for t in heard}),
                "plays": sum(t["plays"] for t in group),
                "minutes": sum(t["minutes"] for t in group),
                "catalogue_share": len(group) / len(paired) * 100,
                "listening_share": len(heard) / paired_heard * 100
                if paired_heard
                else 0.0,
                "examples": _examples(group),
            }
        )
    return {
        "key": key,
        "x": x,
        "y": y,
        "coverage": {
            "catalogue_tracks": len(tracks),
            "paired_tracks": len(paired),
            "heard_tracks": sum(t["heard"] for t in tracks),
            "paired_heard_tracks": paired_heard,
        },
        "cells": cells,
    }


def build_sonic_insights(tracks: list[dict]) -> dict:
    """Count all resolved tracks into exact, stable 10 by 8 sonic regions.

    Domains depend on the complete current catalogue, never the heard cohort.
    Bounded diverse examples illustrate each occupied region without changing
    its full-population counts. Each eligible input row represents one track.
    """
    readings = [sonic_track_reading(t) for t in tracks]
    tempos = [t["bpm"] for t in readings if t["bpm"] is not None]
    loudness = [
        t["integrated_lufs"] for t in readings if t["integrated_lufs"] is not None
    ]
    tempo = {
        "label": "Tempo",
        "unit": "BPM",
        "min": 0,
        "max": max(200, math.ceil(max(tempos, default=0) / 20) * 20),
        "bins": 10,
    }
    energy = {"label": "Energy", "unit": "", "min": 0, "max": 1, "bins": 8}
    lufs = {
        "label": "Integrated loudness",
        "unit": "LUFS",
        "min": min(-10, math.floor(min(loudness, default=-10) / 5) * 5),
        "max": max(0, math.ceil(max(loudness, default=0) / 5) * 5),
        "bins": 8,
    }
    return {
        "version": 1,
        "source": {
            "analyzer_version": ANALYZER_VERSION,
            "profile_version": PROFILE_SCHEMA_VERSION,
            "measurement_version": MEASUREMENT_VERSION,
        },
        "planes": [
            _plane(readings, "tempo_energy", "energy", tempo, energy),
            _plane(readings, "tempo_lufs", "integrated_lufs", tempo, lufs),
        ],
    }


__all__ = ["build_sonic_insights", "sonic_track_reading"]
