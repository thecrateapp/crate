"""Compute Smart Mix profiles for a pool of tracks with the worker's own handler.

The entry point for a new edge set from audio files (Smart Mix 3, SM5): the tracks
must exist in the database (``library_tracks`` rows whose ``path`` the container can
read, e.g. a library sync or a copy of the rows) and this tool runs the production
``compute_smart_mix_profile`` handler on each, in this process: Beat This!, YAMNet,
``crate-cli`` and the publication, exactly as the analysis worker. Run it in the
analysis worker image with the audio mounted where the paths point.

**It writes** profiles, signals and task rows to the database it is given, so it
refuses anything but a loopback database and the shared development database
(``crate``): use a copy migrated to the branch's head.

It then writes, into ``--output``:

- ``pool_uids.txt``: entity UIDs of the tracks ready for v3 (current analyzer,
  phrases, usable and fresh), for ``build_pool_dataset.py --uids``;
- ``groups.tsv``: ``<uid>\\t<group>`` from the second column of ``--tracks``, for
  ``build_pool_dataset.py --groups``;
- ``analysis.json``: per-state counts and each track's outcome, by track ID (no
  titles or paths).

usage:
    analyze_pool.py --dsn postgresql://crate:crate@localhost:55473/crate_eval \\
        --tracks picks.tsv --output out/electronic [--jobs 4] [--force]

``--tracks`` is a TSV whose first column is the track ID and the optional second
column its group (a header line and other columns are ignored).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common import (
    database_environment,
    describe_database,
    ensure_app_on_path,
    git_commit,
    resolve_dsn,
    write_json,
)

ensure_app_on_path()

# The development stack's own database: shared with Diego's dev work.
SHARED_DATABASES = frozenset({"crate"})
PROFILE_TASK = "compute_smart_mix_profile"


def read_tracks(path: Path) -> dict[int, str | None]:
    """Track ID -> group, from a TSV whose rows start with a numeric ID."""
    tracks: dict[int, str | None] = {}
    for line in path.read_text().splitlines():
        fields = line.rstrip("\n").split("\t")
        if not fields[0].strip().isdigit():
            continue
        group = fields[1].strip() if len(fields) > 1 and fields[1].strip() else None
        tracks.setdefault(int(fields[0]), group)
    return tracks


def refuse_shared_database(database: Mapping[str, str]) -> None:
    if database["database"] in SHARED_DATABASES:
        raise SystemExit(
            f"Refusing to write profiles to {database['database']!r}: use a copy"
            " migrated to the branch's head"
        )


def pool_files(
    rows: Sequence[Mapping[str, Any]], groups: Mapping[int, str | None]
) -> tuple[list[str], dict[str, str], dict[str, int]]:
    """Ready UIDs, their groups, and how many tracks are in each state."""
    from crate.smart_mix.versions import ANALYZER_VERSION

    states: Counter[str] = Counter()
    ready: list[str] = []
    for row in rows:
        if row["analyzer_version"] != ANALYZER_VERSION:
            state = "not_current_analyzer"
        elif row["stale"]:
            state = "stale"
        elif row["quality"] == "unavailable":
            state = "unavailable"
        elif not row["has_phrases"]:
            state = "no_phrases"
        else:
            state = "ready"
            ready.append(str(row["entity_uid"]))
        states[state] += 1
    by_uid = {str(row["entity_uid"]): row["track_id"] for row in rows}
    uids = sorted(ready)
    return (
        uids,
        {uid: group for uid in uids if (group := groups.get(by_uid[uid])) is not None},
        dict(sorted(states.items())),
    )


def _init_worker() -> None:
    """A forked worker must not share the parent's pooled connections."""
    from crate.db.engine import reset_engine

    reset_engine()


def _analyze(track_id: int) -> tuple[int, dict[str, Any]]:
    # TEST_GAP: runs the production handler, models and crate-cli on real audio;
    # exercised by running the tool (README), not in unit tests.
    from crate.db.repositories.tasks import create_task
    from crate.worker_handlers.analysis import ANALYSIS_TASK_HANDLERS

    params = {"track_id": track_id}
    try:
        task_id = create_task(PROFILE_TASK, params, dispatch=False)
        result = ANALYSIS_TASK_HANDLERS[PROFILE_TASK](task_id, params, {})
    except Exception as error:  # one failed track must not stop the pool
        result = {"error": type(error).__name__}
    return track_id, {
        key: result.get(key) for key in ("stored", "outcome", "quality", "error")
    }


def _profile_rows(track_ids: Sequence[int]) -> list[dict[str, Any]]:
    from crate.db.queries.smart_mix_evaluation import get_pool_profile_states

    return get_pool_profile_states(list(track_ids))


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--tracks", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument(
        "--force", action="store_true", help="recompute tracks already ready"
    )
    args = parser.parse_args(argv)
    args.dsn = resolve_dsn(args.dsn)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_EVAL_DSN is required")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: database and handler wiring run against a local copy (README).
    import os

    args = parse_args(argv)
    environment = database_environment(args.dsn)  # loopback only
    database = describe_database(environment)
    refuse_shared_database(database)
    os.environ.update(environment)
    tracks = read_tracks(args.tracks)
    before = {row["track_id"]: row for row in _profile_rows(sorted(tracks))}
    _uids, _groups, ready_before = pool_files(list(before.values()), tracks)
    todo = [
        track_id
        for track_id in sorted(tracks)
        if args.force
        or track_id not in before
        or pool_files([before[track_id]], tracks)[2].get("ready") != 1
    ]
    print(f"{len(tracks)} tracks, {len(todo)} to analyze", file=sys.stderr)
    outcomes: dict[int, dict[str, Any]] = {}
    # Close the parent's connections before forking: children open their own.
    _init_worker()
    with ProcessPoolExecutor(
        max_workers=max(1, args.jobs), initializer=_init_worker
    ) as pool:
        for done, (track_id, outcome) in enumerate(pool.map(_analyze, todo), 1):
            outcomes[track_id] = outcome
            if done % 10 == 0:
                print(f"  {done}/{len(todo)}", file=sys.stderr)
    rows = _profile_rows(sorted(tracks))
    uids, groups, states = pool_files(rows, tracks)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "pool_uids.txt").write_text("".join(f"{uid}\n" for uid in uids))
    (args.output / "groups.tsv").write_text(
        "".join(f"{uid}\t{group}\n" for uid, group in sorted(groups.items()))
    )
    write_json(
        args.output / "analysis.json",
        {
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
            "database": database,
            "tracks": len(tracks),
            "analyzed": len(todo),
            "statesBefore": ready_before,
            "states": states,
            "outcomes": {str(key): value for key, value in sorted(outcomes.items())},
        },
    )
    print(json.dumps(states), file=sys.stderr)
    return 0


__all__ = ["SHARED_DATABASES", "pool_files", "read_tracks", "refuse_shared_database"]


if __name__ == "__main__":
    raise SystemExit(main())
