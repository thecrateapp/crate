from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest

from build_dataset import (
    GenreRoots,
    RankedCandidate,
    allocate_quotas,
    build_dataset,
    tempo_band,
)
from crate.db.queries.smart_mix_evaluation import EvaluationSeed
from crate.smart_mix.models import TrackMixProfile


def _profile(uid: str, bpm: float | None) -> TrackMixProfile:
    return TrackMixProfile(
        track_entity_uid=uid,
        profile_version=1,
        profile_revision=f"rev-{uid[:8]}",
        analyzer="crate-rust",
        analyzer_version="smart-mix-audio-v6",
        source_revision="source",
        duration_ms=240_000,
        quality="full",
        analyzed_at=datetime(2026, 11, 4, tzinfo=UTC),
        bpm=bpm,
    )


ROOTS = GenreRoots(
    top_level_of={
        "deep house": "electronic",
        "techno": "electronic",
        "grunge": "rock",
        "rock": "rock",
        "britpop": "britpop",
    }.get,
    top_levels=("electronic", "rock"),
)


class _FakeCompatibles:
    """Every seed gets one candidate per band plus one beyond 6 %."""

    def __init__(self, *, shared_incoming: bool = False) -> None:
        self.calls: list[str] = []
        self.shared_incoming = shared_incoming
        self.titles: list[str] = []

    def __call__(self, seed_uid: str):
        self.calls.append(seed_uid)
        seed = _profile(seed_uid, 120.0)
        candidates = []
        for index, bpm in enumerate((120.0, 117.0, 114.5, 100.0)):
            uid = (
                f"00000000-0000-4000-8000-{index:012d}"
                if self.shared_incoming
                else str(uuid.uuid5(uuid.NAMESPACE_URL, f"{seed_uid}/{index}"))
            )
            candidates.append(
                RankedCandidate(
                    profile=_profile(uid, bpm),
                    genre="Techno",
                    score=0.9 - index * 0.1,
                )
            )
        return seed, candidates


def _seeds(*genres: str | None) -> list[EvaluationSeed]:
    return [
        EvaluationSeed(
            track_entity_uid=str(uuid.uuid5(uuid.NAMESPACE_URL, f"seed/{index}")),
            genre=genre,
        )
        for index, genre in enumerate(genres)
    ]


@pytest.mark.parametrize(
    ("delta", "band"),
    [
        (0.0, "0-2"),
        (0.0199, "0-2"),
        (0.02, "2-4"),
        (0.0399, "2-4"),
        (0.04, "4-6"),
        (0.06, "4-6"),
        (0.0601, None),
        (None, None),
    ],
)
def test_tempo_band_edges(delta: float | None, band: str | None) -> None:
    assert tempo_band(delta) == band


def test_genre_roots_resolve_the_first_known_name() -> None:
    assert ROOTS.root("Deep House") == "electronic"
    assert ROOTS.root("Britpop, Rock") == "rock"
    assert ROOTS.root("Grunge; Techno") == "rock"
    assert ROOTS.root(None) == "unknown"
    assert ROOTS.root("  ") == "unknown"
    assert ROOTS.root("Zzz") == "other"


def test_allocate_quotas_spreads_evenly_and_refills_shortfalls() -> None:
    assert allocate_quotas({"a": 10, "b": 1, "c": 10}, 12) == {"a": 6, "b": 1, "c": 5}
    assert allocate_quotas({"a": 2, "b": 1}, 10) == {"a": 2, "b": 1}
    assert allocate_quotas({"a": 5, "b": 0}, 3) == {"a": 3, "b": 0}
    assert allocate_quotas({}, 5) == {}


def test_build_dataset_stratifies_by_genre_and_tempo_band() -> None:
    compatibles = _FakeCompatibles()
    seeds = _seeds("Deep House", "Grunge", "Techno", None, "Rock")

    rows, stats = build_dataset(
        seeds,
        edges=6,
        compatibles=compatibles,
        roots=ROOTS,
        max_seeds_per_genre=5,
    )

    strata = [row["stratum"] for row in rows]
    assert len(rows) == 6
    assert sorted(set(strata)) == strata == sorted(strata)
    assert {row["rootGenre"] for row in rows} == {"electronic", "rock"}
    assert {row["tempoBand"] for row in rows} == {"0-2", "2-4", "4-6"}
    assert all(row["tempoDelta"] <= 0.06 for row in rows)
    assert [row["edgeId"] for row in rows] == [f"e{n:04d}" for n in range(1, 7)]
    assert stats["strata"] == {stratum: 1 for stratum in strata}
    # The unknown-genre seed forms its own stratum but gets no edge when the
    # quota is spent on the first strata in order.
    assert "unknown/0-2" in stats["available"]
    assert stats["seedsQueried"] <= len(seeds)


def test_build_dataset_never_reuses_an_incoming_track() -> None:
    rows, _stats = build_dataset(
        _seeds("Techno", "Deep House", "Techno"),
        edges=9,
        compatibles=_FakeCompatibles(shared_incoming=True),
        roots=ROOTS,
        max_seeds_per_genre=5,
    )

    incoming = [row["incomingTrackEntityUid"] for row in rows]
    assert len(incoming) == len(set(incoming)) == 3


def test_dataset_rows_carry_identities_but_never_titles() -> None:
    rows, _stats = build_dataset(
        _seeds("Techno"),
        edges=3,
        compatibles=_FakeCompatibles(),
        roots=ROOTS,
        max_seeds_per_genre=5,
    )

    assert set(rows[0]) == {
        "edgeId",
        "stratum",
        "rootGenre",
        "tempoBand",
        "tempoDelta",
        "outgoingTrackEntityUid",
        "incomingTrackEntityUid",
        "outgoingProfileRevision",
        "incomingProfileRevision",
        "outgoingAnalyzerVersion",
        "incomingAnalyzerVersion",
        "outgoingQuality",
        "incomingQuality",
        "incomingRootGenre",
        "compatibleRank",
        "compatibleScore",
    }
    serialized = json.dumps(rows)
    assert "title" not in serialized.lower()
    assert "artist" not in serialized.lower()
