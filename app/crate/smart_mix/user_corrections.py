"""A Crate Decks user's corrections on top of a Smart Mix profile (F8.SM).

Crate Decks keeps each user's own BPM, beat grid and Camelot key per track (S7,
``user_track_corrections``). For plans Decks requests, the planner reads the profile
with the user's correction applied instead of the shared analysis. This module holds
every override rule; it is pure, so the planner path and the tests share it.

Rules:

- A missing or cleared correction (BPM, grid and key all null) applies nothing.
- A corrected grid (absolute beat positions in ms, no downbeat) moves
  ``beat_anchor_ms`` to its first beat. ``downbeat_anchor_ms`` and the intro/outro
  beat and downbeat anchors snap to the corrected beat nearest the profile's value,
  which keeps the profile's bar phase; an anchor the profile did not have stays
  null. A beat grid the reader loaded (the stems layer's) becomes the corrected one.
- The corrected BPM is the correction's, or the grid's median beat when only the
  grid was corrected. It replaces ``bpm``, ``intro_bpm`` and ``outro_bpm``; with no
  grid, the anchors stay the profile's.
- A corrected BPM or grid sets ``bpm_confidence`` to 1; a corrected key sets
  ``camelot`` and ``key_confidence`` to 1.
- Phrases: with a corrected BPM within ``PHRASE_SNAP_BPM_TOLERANCE`` of the
  profile's, each phrase start snaps to the nearest corrected downbeat (every
  ``time_signature`` beats of the corrected grid from the snapped downbeat anchor);
  without a grid there is nothing to snap to and they stay. A larger correction, or
  snapped phrases that no longer fit their bar counts, drops the phrases (and what
  is stored per phrase: the voice bytes and the stems layer), so the planner uses
  its bar heuristic for the track.
"""

from __future__ import annotations

import hashlib
import json
from bisect import bisect_left
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from statistics import median
from typing import Any

from crate.smart_mix.models import Phrase, TrackMixProfile

# A corrected BPM this close to the profile's keeps the analysed phrases.
PHRASE_SNAP_BPM_TOLERANCE = 0.02
_BEATS_PER_BAR = 4


@dataclass(frozen=True, slots=True)
class UserCorrection:
    """One user's correction of one track, as ``get_decks_corrections`` reads it."""

    entity_uid: str
    revision: int
    bpm: float | None = None
    beat_grid_ms: tuple[int, ...] | None = None
    key: str | None = None

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> UserCorrection:
        grid = row.get("beat_grid_ms")
        bpm = row.get("bpm")
        return cls(
            entity_uid=str(row["entity_uid"]),
            revision=int(row["revision"]),
            bpm=None if bpm is None else float(bpm),
            beat_grid_ms=tuple(int(beat) for beat in grid) if grid else None,
            key=row.get("key"),
        )

    @property
    def cleared(self) -> bool:
        return self.bpm is None and self.beat_grid_ms is None and self.key is None

    def identity(self) -> str:
        """A digest of what the correction changes, for the plan cache key: two
        corrections share it only when they change a profile the same way."""
        canonical = json.dumps(
            {
                "bpm": self.bpm,
                "beatGridMs": list(self.beat_grid_ms or ()),
                "key": self.key,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def apply_user_correction(
    profile: TrackMixProfile, correction: UserCorrection | None
) -> TrackMixProfile:
    """``profile`` with ``correction`` applied (see the module rules)."""
    if correction is None or correction.cleared:
        return profile
    changes: dict[str, Any] = {}
    if correction.key is not None:
        changes.update(camelot=correction.key, key_confidence=1.0)
    grid = correction.beat_grid_ms
    bpm = correction.bpm if correction.bpm is not None else _grid_bpm(grid)
    if bpm is not None:
        changes.update(bpm=bpm, intro_bpm=bpm, outro_bpm=bpm)
    if bpm is not None or grid is not None:
        changes["bpm_confidence"] = 1.0
    if grid is not None:
        changes.update(_snapped_anchors(profile, grid))
        if profile.beat_grid_ms:
            changes.update(beat_grid_ms=grid, beat_grid_format="delta-ms-v1")
    if profile.phrases is not None and bpm is not None:
        changes.update(
            _corrected_phrases(
                profile, bpm, grid, changes.get("downbeat_anchor_ms", None)
            )
        )
    return replace(profile, **changes)


def _grid_bpm(grid: Sequence[int] | None) -> float | None:
    if grid is None or len(grid) < 2:
        return None
    beat_ms = median(b - a for a, b in zip(grid, grid[1:]))
    return 60_000.0 / beat_ms if beat_ms > 0 else None


def _snapped_anchors(profile: TrackMixProfile, grid: Sequence[int]) -> dict[str, Any]:
    changes: dict[str, Any] = {"beat_anchor_ms": int(grid[0])}
    for field_name in (
        "downbeat_anchor_ms",
        "intro_beat_ms",
        "outro_beat_ms",
        "intro_downbeat_ms",
        "outro_downbeat_ms",
    ):
        value = getattr(profile, field_name)
        if value is not None:
            changes[field_name] = int(grid[_nearest_index(grid, value)])
    return changes


def _corrected_phrases(
    profile: TrackMixProfile,
    bpm: float,
    grid: Sequence[int] | None,
    downbeat_anchor_ms: int | None,
) -> dict[str, Any]:
    phrases = profile.phrases
    if not phrases:
        return {}
    within = (
        profile.bpm is not None
        and abs(bpm - profile.bpm) <= PHRASE_SNAP_BPM_TOLERANCE * profile.bpm
    )
    if not within:
        return _without_phrases()
    if grid is None:
        return {}
    snapped = _snapped_phrases(
        phrases, grid, downbeat_anchor_ms, profile.time_signature or _BEATS_PER_BAR
    )
    if snapped is None:
        return _without_phrases()
    return {"phrases": snapped}


def _snapped_phrases(
    phrases: Sequence[Phrase],
    grid: Sequence[int],
    downbeat_anchor_ms: int | None,
    beats_per_bar: int,
) -> tuple[Phrase, ...] | None:
    """Each phrase on the corrected downbeat nearest its start, or None when there
    is no downbeat or the snapped phrases would overlap (``Phrase`` counts bars of
    four beats, as the stored ones do)."""
    if downbeat_anchor_ms is None:
        return None
    anchor = _nearest_index(grid, downbeat_anchor_ms)
    downbeats = list(range(anchor % beats_per_bar, len(grid), beats_per_bar))
    if not downbeats:
        return None
    positions = [grid[index] for index in downbeats]
    snapped: list[Phrase] = []
    for phrase in phrases:
        index = downbeats[_nearest_index(positions, phrase.start_ms)]
        current = replace(phrase, start_beat=index, start_ms=int(grid[index]))
        if snapped and (
            current.start_beat
            < snapped[-1].start_beat + _BEATS_PER_BAR * snapped[-1].bars
            or current.start_ms <= snapped[-1].start_ms
        ):
            return None
        snapped.append(current)
    return tuple(snapped)


def _without_phrases() -> dict[str, Any]:
    return {
        "phrases": None,
        "vocal_presence": None,
        "vocal_detector": None,
        "stems": None,
    }


def _nearest_index(grid: Sequence[int], position: int) -> int:
    """Index of the value of ``grid`` nearest ``position``; the earlier on a tie."""
    after = bisect_left(grid, position)
    if after == 0:
        return 0
    if after == len(grid):
        return len(grid) - 1
    before = after - 1
    return before if position - grid[before] <= grid[after] - position else after


__all__ = [
    "PHRASE_SNAP_BPM_TOLERANCE",
    "UserCorrection",
    "apply_user_correction",
]
