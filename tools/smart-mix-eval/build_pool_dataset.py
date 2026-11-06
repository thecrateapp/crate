"""Build an evaluation edge set inside a fixed pool of tracks (Smart Mix 3, SM2).

``build_dataset.py`` asks the compatible-tracks service for each seed's partners
over the whole library. That cannot pair the few tracks that have audio and
analyzer v7 phrases in a development library (the spike tracks): their best
partners are elsewhere. This tool pairs a pool given as a list of entity UIDs
with itself, so planners that read the structure (smart-mix-v3) can be compared on
edges whose tracks all have phrases, and the edges can be rendered for listening.

Each seed keeps its best partner in each tempo band (0-2, 2-4, 4-6 %), as
``build_dataset.py`` does, ranked by the planner's own pure compatibility score
(``crate.smart_mix.planner.score_compatibility``: transition fit, with neutral
Bliss and genre, which a pool of a few tracks does not need). The pool is small, so
an incoming track may serve several seeds. Rows keep the format of
``dataset.jsonl`` with the root genre ``pool``; they hold entity UIDs and profile
revisions, never titles.

usage:
    build_pool_dataset.py --dsn postgresql://crate:crate@localhost:5433/crate \
        --uids pool_uids.txt --output tools/smart-mix-eval/out/pool
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from build_dataset import TEMPO_BANDS, CandidateEdge, dataset_row, tempo_band
from common import (
    ensure_app_on_path,
    git_commit,
    open_read_only_database,
    resolve_dsn,
    write_json,
    write_jsonl,
)

ensure_app_on_path()

from crate.smart_mix.evaluation import edge_tempo_delta  # noqa: E402
from crate.smart_mix.models import TrackMixProfile  # noqa: E402
from crate.smart_mix.planner import score_compatibility  # noqa: E402

POOL_GENRE = "pool"


def pool_edges(
    profiles: Sequence[TrackMixProfile], *, require_phrases: bool = True
) -> list[CandidateEdge]:
    """Each seed's best-scoring partner per tempo band, in seed then band order."""
    pool = sorted(
        (profile for profile in profiles if not require_phrases or profile.phrases),
        key=lambda profile: profile.track_entity_uid,
    )
    edges: list[CandidateEdge] = []
    for seed in pool:
        ranked = sorted(
            (
                (score_compatibility(seed, other).overall, other)
                for other in pool
                if other.track_entity_uid != seed.track_entity_uid
            ),
            key=lambda item: (-item[0], item[1].track_entity_uid),
        )
        filled: set[str] = set()
        for rank, (score, other) in enumerate(ranked, start=1):
            delta = edge_tempo_delta(seed, other)
            band = tempo_band(delta)
            if band is None or delta is None or band in filled:
                continue
            filled.add(band)
            edges.append(
                CandidateEdge(
                    outgoing=seed,
                    incoming=other,
                    root_genre=POOL_GENRE,
                    incoming_root_genre=POOL_GENRE,
                    tempo_band=band,
                    tempo_delta=delta,
                    compatible_rank=rank,
                    compatible_score=score,
                )
            )
    band_order = {band: index for index, (band, _low, _high) in enumerate(TEMPO_BANDS)}
    return sorted(
        edges,
        key=lambda edge: (
            band_order[edge.tempo_band],
            edge.outgoing.track_entity_uid,
        ),
    )


def read_uids(path: Path) -> list[str]:
    return sorted(
        {line.strip() for line in path.read_text().splitlines() if line.strip()}
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--uids", type=Path, required=True, help="one UID per line")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--all-profiles",
        action="store_true",
        help="also pair tracks without phrases (by default both need them)",
    )
    parser.add_argument("--allow-remote-database", action="store_true")
    args = parser.parse_args(argv)
    args.dsn = resolve_dsn(args.dsn)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_EVAL_DSN is required")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: the database read is exercised by running the tool against the dev
    # library (see README); the pairing above is unit tested.
    args = parse_args(argv)
    database = open_read_only_database(
        args.dsn, allow_remote=args.allow_remote_database
    )
    from crate.db.repositories.smart_mix import get_track_mix_profiles_by_entity_uids

    uids = read_uids(args.uids)
    loaded = get_track_mix_profiles_by_entity_uids(uids, include_structure=True)
    profiles = [profile for profile in loaded if profile is not None]
    edges = pool_edges(profiles, require_phrases=not args.all_profiles)
    rows = [dataset_row(index, edge) for index, edge in enumerate(edges, start=1)]
    args.output.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output / "dataset.jsonl", rows)
    stats: dict[str, Any] = {
        "edges": len(rows),
        "poolUids": len(uids),
        "poolProfiles": len(profiles),
        "poolWithPhrases": sum(1 for profile in profiles if profile.phrases),
        "requirePhrases": not args.all_profiles,
        "strata": {
            band: sum(1 for row in rows if row["tempoBand"] == band)
            for band, _low, _high in TEMPO_BANDS
        },
    }
    write_json(
        args.output / "dataset.meta.json",
        {
            **stats,
            "pairing": "best score_compatibility partner per tempo band in the pool",
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
            "database": database,
            "readOnly": True,
            "tempoBands": [band for band, _low, _high in TEMPO_BANDS],
        },
    )
    print(
        f"{len(rows)} edges from {len(profiles)} profiles -> {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
