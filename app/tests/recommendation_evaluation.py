"""Offline evidence for seeded radio; artist genres are a proxy, not a music verdict.

Run from app/: ../.venv/bin/python -m tests.recommendation_evaluation
The report records current rankings without making those lists a permanent contract.
"""

from __future__ import annotations

import argparse
import json
from contextlib import ExitStack
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path
from unittest.mock import patch

from crate import radio_engine
from crate.recommendation_policy import canonical_key
from crate.db.paths_similarity import make_radio_genre_overlap_scorer
from crate.queue_engine import candidate_artist_key, candidate_song_key, generation_seed

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "recommendations"
_SESSION_IDS = ("baseline-a", "baseline-b", "baseline-c")


def _forbid_io(*_args, **_kwargs):
    raise AssertionError(
        "Offline recommendation evaluation attempted database/Redis I/O"
    )


def generate_snapshot_batch(
    snapshot: dict,
    *,
    session_id: str,
    reference_day: str | None = None,
    recent_plays: dict | None = None,
) -> dict:
    """Run the real engine on independent copies, with explicit day and session seeds."""
    if snapshot["schema_version"] != 1:
        raise ValueError("Unsupported recommendation snapshot schema")
    reference_day = date.fromisoformat(
        reference_day or snapshot["reference_day"]
    ).isoformat()
    session = deepcopy(snapshot["initial_session"])
    if session["user_id"] != 0:
        raise ValueError("Offline snapshots must use synthetic user_id=0")
    if session["seed_type"] not in radio_engine._SEEDED_CONTEXT_RADIO_TYPES:
        raise ValueError("Offline evaluation requires a seeded radio session")
    session["id"] = session_id
    session["generation_seed"] = generation_seed(
        listener_id=0,
        context=f"radio:{session['mode']}:{session['seed_type']}",
        session_id=session_id,
        reference_day=reference_day,
    )

    def load_graphs(**_kwargs):
        graphs = deepcopy(snapshot["graphs"])
        return (
            graphs["similarity"],
            graphs["genres"],
            {
                artist: set(members)
                for artist, members in graphs["shared_members"].items()
            },
        )

    with ExitStack() as stack:
        stack.enter_context(
            patch.object(radio_engine, "_load_radio_graphs", load_graphs)
        )
        if hasattr(radio_engine, "history_for_candidates"):
            stack.enter_context(
                patch.object(
                    radio_engine,
                    "history_for_candidates",
                    lambda *_args, **_kwargs: deepcopy(recent_plays or {}),
                )
            )
        stack.enter_context(
            patch.object(
                radio_engine,
                "_seeded_radio_candidate_rows",
                lambda *_args, **_kwargs: deepcopy(snapshot["candidate_rows"]),
            )
        )
        for target in (
            "crate.radio_engine._redis",
            "crate.radio_engine._save_session",
            "crate.radio_engine.persist_radio_feedback",
            "crate.db.tx.get_session_factory",
            "crate.db.cache_runtime.get_redis",
            "sqlalchemy.engine.Engine.connect",
            "sqlalchemy.orm.Session.execute",
            "sqlalchemy.orm.Session.commit",
            "redis.Redis.execute_command",
            "redis.client.Pipeline.execute",
        ):
            stack.enter_context(patch(target, _forbid_io))
        tracks = radio_engine._generate_batch(
            session,
            count=snapshot["batch_size"],
            now=datetime.combine(
                date.fromisoformat(reference_day), datetime.min.time(), timezone.utc
            ),
        )

    return {
        "session_id": session_id,
        "reference_day": reference_day,
        "generation_seed": session["generation_seed"],
        "tracks": tracks,
    }


def overlap_metrics(left: list[dict], right: list[dict]) -> dict:
    """Compare canonical song sets and the same identity at the same queue position."""
    left_keys = [candidate_song_key(track) for track in left]
    right_keys = [candidate_song_key(track) for track in right]
    if None in left_keys or None in right_keys:
        raise ValueError("Overlap requires a canonical artist/title for every track")
    shared = set(left_keys) & set(right_keys)
    union = set(left_keys) | set(right_keys)
    matches = sum(a == b for a, b in zip(left_keys, right_keys))
    return {
        "shared_song_count": len(shared),
        "identity_jaccard": len(shared) / len(union) if union else 0.0,
        "same_position_count": matches,
        "same_position_ratio": matches / max(len(left), len(right))
        if left or right
        else 0.0,
    }


def coherence_metrics(snapshot: dict, tracks: list[dict]) -> dict:
    """Measure artist-genre overlap against the seed separately from data coverage.

    Genre overlap uses the engine's static ancestor taxonomy and weighted Jaccard.
    Missing candidate metadata is excluded from that mean and reported as coverage.
    """
    session = snapshot["initial_session"]
    genre_map = deepcopy(snapshot["graphs"]["genres"])
    seed_artists = list(session.get("seed_artists") or [])
    if not seed_artists and session["seed_type"] == "artist":
        seed_artists = [session["seed_label"]]
    seed_genres = (session.get("queue_intent") or {}).get("genres") or []
    if seed_genres:
        genre_map["__radio_seed_genres__"] = {genre: 1.0 for genre in seed_genres}
        seed_artists.append("__radio_seed_genres__")
    score = make_radio_genre_overlap_scorer(genre_map, seed_artists)

    def has_genres(artist: str) -> bool:
        return any(weight > 0 for weight in genre_map.get(artist.lower(), {}).values())

    covered = [track for track in tracks if has_genres(track["artist"])]
    seed_covered = sum(has_genres(artist) for artist in seed_artists)
    artists = {candidate_artist_key(track) for track in tracks} - {""}
    overlaps = (
        [score(track["artist"], seed_artists, genre_map) for track in covered]
        if seed_covered
        else []
    )
    return {
        "mean_seed_genre_overlap": sum(overlaps) / len(overlaps) if overlaps else None,
        "genre_metadata_track_count": len(covered),
        "genre_metadata_coverage": len(covered) / len(tracks) if tracks else 0.0,
        "seed_genre_coverage": seed_covered / len(seed_artists)
        if seed_artists
        else 0.0,
        "unique_artist_count": len(artists),
        "unique_artist_ratio": len(artists) / len(tracks) if tracks else 0.0,
    }


def evaluate_snapshot(
    snapshot: dict,
    *,
    session_ids: tuple[str, ...] = _SESSION_IDS,
    simulate_listens: bool = False,
) -> dict:
    """Report fixed-day starts, optionally marking previous batches as completed listens."""
    start_day = date.fromisoformat(snapshot["reference_day"])
    sessions = []
    history = {}
    for index, value in enumerate(session_ids):
        day = (start_day + timedelta(days=index)).isoformat()
        batch = generate_snapshot_batch(
            snapshot,
            session_id=value,
            reference_day=day,
            recent_plays=history,
        )
        sessions.append(batch)
        if simulate_listens:
            for track in batch["tracks"]:
                if (key := canonical_key(track)) is not None:
                    history[key] = {
                        "last_significant_play_at": datetime.fromisoformat(
                            day + "T12:00:00+00:00"
                        ),
                        "frequency": history.get(key, {}).get("frequency", 0) + 1,
                        "completed": history.get(key, {}).get("completed", 0) + 1,
                    }
    for session in sessions:
        session["coherence"] = coherence_metrics(snapshot, session["tracks"])
        session["tracks"] = [
            {
                key: track.get(key)
                for key in ("track_id", "entity_uid", "artist", "title")
            }
            for track in session["tracks"]
        ]
    return {
        "name": snapshot["name"],
        "provenance": deepcopy(snapshot["provenance"]),
        "reference_day": snapshot["reference_day"],
        "requested_batch_size": snapshot["batch_size"],
        "candidate_count": len(snapshot["candidate_rows"]),
        "listening_scenario": "completed batches between sessions"
        if simulate_listens
        else "no listens",
        "genre_metric_note": "Artist genres are a metadata proxy, not a musical verdict.",
        "sessions": sessions,
        "overlap": [
            {
                "left_session_id": left["session_id"],
                "right_session_id": right["session_id"],
                **overlap_metrics(left["tracks"], right["tracks"]),
            }
            for left, right in combinations(sessions, 2)
        ],
    }


def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshots", nargs="*", type=Path)
    parser.add_argument("--simulate-listens", action="store_true")
    args = parser.parse_args()
    paths = args.snapshots or [
        _FIXTURE_DIR / f"{name}.json" for name in ("citizen", "concubine")
    ]
    reports = [
        evaluate_snapshot(
            json.loads(path.read_text()), simulate_listens=args.simulate_listens
        )
        for path in paths
    ]
    print(json.dumps(reports, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    _main()
