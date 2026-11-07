"""Build the Smart Mix evaluation edge set from a development library.

Edges come from the compatible-tracks service, the same ranking a DJ sees as
"what can follow this track", seeded by a deterministic sample of tracks.
They are stratified by the outgoing track's root genre and by the tempo
adjustment the incoming track needs (0-2 %, 2-4 %, 4-6 %), with the same
number of edges per stratum when the library has them.

The output keeps entity UIDs and profile revisions, never titles or artists:

    dataset.jsonl       one edge per line
    dataset.meta.json   parameters, source database (no credentials), counts

usage:
    build_dataset.py --dsn postgresql://crate:crate@localhost:5433/crate \
        --output tools/smart-mix-eval/out/dev [--edges 300] [--seed sm0]
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from common import (
    ensure_app_on_path,
    git_commit,
    open_read_only_database,
    resolve_dsn,
    write_json,
    write_jsonl,
)

ensure_app_on_path()

from crate.genre_taxonomy import split_genre_names  # noqa: E402
from crate.smart_mix.evaluation import edge_tempo_delta  # noqa: E402

if TYPE_CHECKING:
    from crate.db.queries.smart_mix_evaluation import EvaluationSeed
    from crate.smart_mix.models import TrackMixProfile


TEMPO_BANDS = (("0-2", 0.0, 0.02), ("2-4", 0.02, 0.04), ("4-6", 0.04, 0.06))
UNKNOWN_GENRE = "unknown"
OTHER_GENRE = "other"
DEFAULT_EDGES = 300
DEFAULT_SEED = "smart-mix-3-sm0"
DEFAULT_SEED_SAMPLE = 20_000
DEFAULT_CANDIDATES_PER_SEED = 50
DEFAULT_MAX_SEEDS_PER_GENRE = 40
POOL_FACTOR = 3


@dataclass(frozen=True, slots=True)
class RankedCandidate:
    profile: TrackMixProfile
    genre: str | None
    score: float


Compatibles = Callable[[str], "tuple[TrackMixProfile | None, list[RankedCandidate]]"]


@dataclass(frozen=True, slots=True)
class CandidateEdge:
    outgoing: TrackMixProfile
    incoming: TrackMixProfile
    root_genre: str
    incoming_root_genre: str
    tempo_band: str
    tempo_delta: float
    compatible_rank: int
    compatible_score: float

    @property
    def stratum(self) -> str:
        return f"{self.root_genre}/{self.tempo_band}"


class GenreRoots:
    """Map a free-text genre to its root (top-level) genre slug."""

    def __init__(
        self,
        *,
        top_level_of: Callable[[str], str | None],
        top_levels: Iterable[str],
    ) -> None:
        self._top_level_of = top_level_of
        self._top_levels = frozenset(top_levels)

    @classmethod
    def from_taxonomy(cls) -> GenreRoots:
        """The runtime taxonomy: shipped genres plus the library's own nodes."""
        from crate.genre_taxonomy import get_genre_catalog, get_top_level_slug

        catalog = get_genre_catalog()
        return cls(
            top_level_of=get_top_level_slug,
            top_levels=(slug for slug, meta in catalog.items() if meta["top_level"]),
        )

    def root(self, genre: str | None) -> str:
        names = split_genre_names(genre or "")
        if not names:
            return UNKNOWN_GENRE
        for name in names:
            slug = self._top_level_of(name)
            if slug in self._top_levels:
                return slug
        return OTHER_GENRE


def tempo_band(delta: float | None) -> str | None:
    if delta is None:
        return None
    for name, low, high in TEMPO_BANDS:
        if low <= delta < high:
            return name
    last_name, _low, last_high = TEMPO_BANDS[-1]
    return last_name if delta <= last_high + 1e-12 else None


def allocate_quotas(available: Mapping[str, int], total: int) -> dict[str, int]:
    """Split ``total`` evenly across strata, refilling shortfalls from the rest.

    Strata are visited in sorted order, so a remainder goes to the first ones.
    """
    quotas = {key: 0 for key in available}
    remaining = max(0, int(total))
    open_keys = sorted(key for key, count in available.items() if count > 0)
    while remaining > 0 and open_keys:
        share, extra = divmod(remaining, len(open_keys))
        taken = 0
        still_open: list[str] = []
        for index, key in enumerate(open_keys):
            wanted = share + (1 if index < extra else 0)
            take = min(wanted, available[key] - quotas[key])
            quotas[key] += take
            taken += take
            if quotas[key] < available[key]:
                still_open.append(key)
        if taken == 0:
            break
        remaining -= taken
        open_keys = still_open
    return quotas


def collect_candidate_pools(
    seeds: Sequence[EvaluationSeed],
    *,
    compatibles: Compatibles,
    roots: GenreRoots,
    pool_target: int,
    max_seeds_per_genre: int,
) -> tuple[dict[str, list[CandidateEdge]], int]:
    """Query compatibles seed by seed until every band of a genre has a pool.

    Each seed contributes at most one edge per band (its best-ranked
    candidate there) and an incoming track is never used twice.
    """
    seeds_by_root: dict[str, list[EvaluationSeed]] = defaultdict(list)
    for seed in seeds:
        seeds_by_root[roots.root(seed.genre)].append(seed)
    pools: dict[str, list[CandidateEdge]] = {
        f"{root}/{band}": []
        for root in seeds_by_root
        for band, _low, _high in TEMPO_BANDS
    }
    used_incoming: set[str] = set()
    queried = 0
    for root in sorted(seeds_by_root):
        bands = [f"{root}/{band}" for band, _low, _high in TEMPO_BANDS]
        for seed in seeds_by_root[root][:max_seeds_per_genre]:
            if all(len(pools[stratum]) >= pool_target for stratum in bands):
                break
            queried += 1
            outgoing, ranked = compatibles(seed.track_entity_uid)
            if outgoing is None:
                continue
            filled: set[str] = set()
            for rank, candidate in enumerate(ranked, start=1):
                incoming = candidate.profile
                if incoming.track_entity_uid in used_incoming:
                    continue
                delta = edge_tempo_delta(outgoing, incoming)
                band = tempo_band(delta)
                if band is None or delta is None:
                    continue
                stratum = f"{root}/{band}"
                if stratum in filled or len(pools[stratum]) >= pool_target:
                    continue
                pools[stratum].append(
                    CandidateEdge(
                        outgoing=outgoing,
                        incoming=incoming,
                        root_genre=root,
                        incoming_root_genre=roots.root(candidate.genre),
                        tempo_band=band,
                        tempo_delta=delta,
                        compatible_rank=rank,
                        compatible_score=candidate.score,
                    )
                )
                filled.add(stratum)
                used_incoming.add(incoming.track_entity_uid)
    return pools, queried


def build_dataset(
    seeds: Sequence[EvaluationSeed],
    *,
    edges: int,
    compatibles: Compatibles,
    roots: GenreRoots,
    max_seeds_per_genre: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return the dataset rows (sorted by stratum) and their counts."""
    strata_count = max(1, len({roots.root(seed.genre) for seed in seeds})) * len(
        TEMPO_BANDS
    )
    pool_target = POOL_FACTOR * math.ceil(max(1, edges) / strata_count)
    pools, queried = collect_candidate_pools(
        seeds,
        compatibles=compatibles,
        roots=roots,
        pool_target=pool_target,
        max_seeds_per_genre=max_seeds_per_genre,
    )
    available = {stratum: len(pool) for stratum, pool in pools.items()}
    quotas = allocate_quotas(available, edges)
    selected = [
        edge for stratum in sorted(pools) for edge in pools[stratum][: quotas[stratum]]
    ]
    rows = [dataset_row(index, edge) for index, edge in enumerate(selected, start=1)]
    stats = {
        "edges": len(rows),
        "requestedEdges": edges,
        "seedsQueried": queried,
        "available": dict(sorted(available.items())),
        "strata": dict(sorted(Counter(row["stratum"] for row in rows).items())),
        "analyzerVersions": dict(
            sorted(
                Counter(
                    version
                    for row in rows
                    for version in (
                        row["outgoingAnalyzerVersion"],
                        row["incomingAnalyzerVersion"],
                    )
                ).items()
            )
        ),
    }
    return rows, stats


def dataset_row(index: int, edge: CandidateEdge) -> dict[str, Any]:
    return {
        "edgeId": f"e{index:04d}",
        "stratum": edge.stratum,
        "rootGenre": edge.root_genre,
        "tempoBand": edge.tempo_band,
        "tempoDelta": round(edge.tempo_delta, 6),
        "outgoingTrackEntityUid": edge.outgoing.track_entity_uid,
        "incomingTrackEntityUid": edge.incoming.track_entity_uid,
        "outgoingProfileRevision": edge.outgoing.profile_revision,
        "incomingProfileRevision": edge.incoming.profile_revision,
        "outgoingAnalyzerVersion": edge.outgoing.analyzer_version,
        "incomingAnalyzerVersion": edge.incoming.analyzer_version,
        "outgoingQuality": str(edge.outgoing.quality),
        "incomingQuality": str(edge.incoming.quality),
        "incomingRootGenre": edge.incoming_root_genre,
        "compatibleRank": edge.compatible_rank,
        "compatibleScore": round(edge.compatible_score, 6),
    }


def library_compatibles(candidates_per_seed: int) -> Compatibles:
    """The compatible-tracks service over the configured database (read-only)."""
    from crate.db.queries.smart_mix_compatible import get_compatible_track_inputs
    from crate.smart_mix.compatible import rank_compatible_tracks

    def compatibles(
        seed_uid: str,
    ) -> tuple[TrackMixProfile | None, list[RankedCandidate]]:
        seed, candidates = get_compatible_track_inputs(seed_uid, max_candidates=500)
        if seed is None:
            return None, []
        by_uid = {candidate.track_entity_uid: candidate for candidate in candidates}
        ranked = rank_compatible_tracks(seed, candidates, limit=candidates_per_seed)
        return seed.profile, [
            RankedCandidate(
                profile=by_uid[item.track_entity_uid].profile,
                genre=item.genre,
                score=item.score,
            )
            for item in ranked
        ]

    return compatibles


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--edges", type=int, default=DEFAULT_EDGES)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--seed-sample", type=int, default=DEFAULT_SEED_SAMPLE)
    parser.add_argument(
        "--candidates-per-seed", type=int, default=DEFAULT_CANDIDATES_PER_SEED
    )
    parser.add_argument(
        "--max-seeds-per-genre", type=int, default=DEFAULT_MAX_SEEDS_PER_GENRE
    )
    parser.add_argument("--allow-remote-database", action="store_true")
    args = parser.parse_args(argv)
    args.dsn = resolve_dsn(args.dsn)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_EVAL_DSN is required")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: the database wiring is exercised by running the tool against
    # the dev library (see README); the selection logic above is unit tested.
    args = parse_args(argv)
    database = open_read_only_database(
        args.dsn, allow_remote=args.allow_remote_database
    )
    from crate.db.queries.smart_mix_evaluation import sample_evaluation_seeds
    from crate.smart_mix.policy import PLANNER_POLICY

    seeds = sample_evaluation_seeds(sample_size=args.seed_sample, seed=args.seed)
    rows, stats = build_dataset(
        seeds,
        edges=args.edges,
        compatibles=library_compatibles(args.candidates_per_seed),
        roots=GenreRoots.from_taxonomy(),
        max_seeds_per_genre=args.max_seeds_per_genre,
    )
    args.output.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output / "dataset.jsonl", rows)
    write_json(
        args.output / "dataset.meta.json",
        {
            **stats,
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
            "database": database,
            "readOnly": True,
            "seed": args.seed,
            "seedSample": len(seeds),
            "candidatesPerSeed": args.candidates_per_seed,
            "maxSeedsPerGenre": args.max_seeds_per_genre,
            "compatiblePolicy": {
                "identifier": PLANNER_POLICY.identifier,
                "rulesRevision": PLANNER_POLICY.rules_revision,
            },
            "tempoBands": [band for band, _low, _high in TEMPO_BANDS],
        },
    )
    print(
        f"{stats['edges']} edges in {len(stats['strata'])} strata "
        f"from {stats['seedsQueried']} seeds -> {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
