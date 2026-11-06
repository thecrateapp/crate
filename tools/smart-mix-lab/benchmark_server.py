"""Measure Smart Mix plan and compatible-track latency on an isolated database."""

from __future__ import annotations

import argparse
import json
import os
import platform
import random
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = REPO_ROOT / "app"
LAB_ARTIST_PREFIX = "smart-mix-lab"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
FIXTURES = {
    "representative-48k": {"artists": 900, "albums": 4_400, "tracks": 48_000},
    "small-2k": {"artists": 40, "albums": 200, "tracks": 2_000},
    # The same catalogue with analyzer v7 structure: phrases, energy curve and
    # voice, the columns planner smart-mix-v3 reads (SM2.PR2).
    "representative-48k-v7": {
        "artists": 900,
        "albums": 4_400,
        "tracks": 48_000,
        "structure": True,
    },
}
PLANNERS = ("smart-mix-v2", "smart-mix-v3")
FIXTURE_PHRASE_BARS = 8
FIXTURE_ANCHOR_MS = 400
FIXTURE_OUTRO_MS = 16_000
STRUCTURE_BATCH = 2_000


class UnsafeDatabaseError(RuntimeError):
    pass


def check_isolated_dsn(dsn: str, *, allow_non_test: bool = False) -> dict[str, str]:
    parsed = urlparse(dsn)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise UnsafeDatabaseError("DSN must be a postgresql:// URL")
    database = parsed.path.lstrip("/")
    host = parsed.hostname or ""
    if not allow_non_test and (host not in LOOPBACK_HOSTS or "test" not in database):
        raise UnsafeDatabaseError(
            "Refusing a DSN that is not a loopback test database "
            f"(host={host!r}, database={database!r})"
        )
    return {
        "CRATE_POSTGRES_USER": parsed.username or "crate",
        "CRATE_POSTGRES_PASSWORD": parsed.password or "",
        "CRATE_POSTGRES_HOST": host,
        "CRATE_POSTGRES_PORT": str(parsed.port or 5432),
        "CRATE_POSTGRES_DB": database,
    }


def percentile(samples: list[float], quantile: float) -> float:
    ordered = sorted(samples)
    if not ordered:
        raise ValueError("no samples")
    index = min(len(ordered) - 1, max(0, round(quantile * (len(ordered) - 1))))
    return round(ordered[index], 3)


def summarize(samples: list[float]) -> dict[str, float | int]:
    return {
        "p50_ms": percentile(samples, 0.50),
        "p95_ms": percentile(samples, 0.95),
        "p99_ms": percentile(samples, 0.99),
        "samples": len(samples),
    }


def measure(
    operation: Callable[[int], Any], *, warmup: int, iterations: int, concurrency: int
) -> list[float]:
    for index in range(warmup):
        operation(index)

    def timed(index: int) -> float:
        started = time.perf_counter()
        operation(warmup + index)
        return (time.perf_counter() - started) * 1_000

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        return list(pool.map(timed, range(iterations)))


def seed_fixture(name: str) -> list[str]:
    from sqlalchemy import text

    from crate.db.tx import read_scope, transaction_scope

    sizes = FIXTURES[name]
    with read_scope() as session:
        existing, structured = session.execute(
            text(
                """
                SELECT COUNT(*), COUNT(profile.phrases)
                FROM library_tracks track
                LEFT JOIN track_mix_profiles profile ON profile.track_id = track.id
                WHERE track.artist LIKE :prefix
                """
            ),
            {"prefix": f"{LAB_ARTIST_PREFIX}-{name}-%"},
        ).one()
    wanted_structure = sizes["tracks"] if sizes.get("structure") else 0
    if existing != sizes["tracks"] or structured != wanted_structure:
        with transaction_scope() as session:
            _insert_fixture(session, text, name, sizes)
            if sizes.get("structure"):
                _add_structure(session, text, name)
    with read_scope() as session:
        return [
            str(uid)
            for uid in session.execute(
                text(
                    """
                    SELECT entity_uid FROM library_tracks
                    WHERE artist LIKE :prefix ORDER BY id
                    """
                ),
                {"prefix": f"{LAB_ARTIST_PREFIX}-{name}-%"},
            ).scalars()
        ]


def _insert_fixture(session, text, name: str, sizes: dict[str, int]) -> None:
    prefix = f"{LAB_ARTIST_PREFIX}-{name}"
    params = {"prefix": prefix, **sizes}
    session.execute(
        text(
            """
            DELETE FROM library_tracks WHERE artist LIKE :prefix || '-%';
            DELETE FROM library_albums WHERE artist LIKE :prefix || '-%';
            DELETE FROM library_artists WHERE name LIKE :prefix || '-%';
            """
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO library_artists (name, entity_uid)
            SELECT :prefix || '-' || artist_index,
                   CAST(md5(:prefix || '-artist-' || artist_index) AS uuid)
            FROM generate_series(1, :artists) AS artist_index
            """
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO library_albums (artist, name, path, entity_uid)
            SELECT :prefix || '-' || (1 + album_index % :artists),
                   'Album ' || album_index,
                   '/lab/' || :prefix || '/album-' || album_index,
                   CAST(md5(:prefix || '-album-' || album_index) AS uuid)
            FROM generate_series(1, :albums) AS album_index
            """
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO library_tracks (
                album_id, artist, album, filename, title, path, entity_uid,
                duration, genre
            )
            SELECT album.id, album.artist, album.name,
                   track_index || '.flac', 'Track ' || track_index,
                   album.path || '/' || track_index || '.flac',
                   CAST(md5(:prefix || '-track-' || track_index) AS uuid),
                   150 + (track_index % 240), 'post-punk'
            FROM generate_series(1, :tracks) AS track_index
            JOIN library_albums album
              ON album.path = '/lab/' || :prefix || '/album-'
                 || (1 + track_index % :albums)
            """
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO track_mix_profiles (
                track_id, profile_version, profile_revision, analyzer,
                analyzer_version, source_revision, quality, bpm,
                bpm_confidence, tempo_stability, beat_anchor_ms,
                downbeat_anchor_ms, time_signature, key_camelot,
                key_confidence, intro_cue_ms, outro_cue_ms, intro_energy,
                outro_energy, global_energy, danceability, valence,
                duration_ms, analyzed_at
            )
            SELECT track.id, 1, 'lab-' || track.id, 'crate-rust',
                   'smart-mix-audio-v4', 'lab-source-' || track.id,
                   CASE WHEN track.id % 10 = 0 THEN 'partial' ELSE 'full' END,
                   80 + (track.id % 90), 0.9, 0.95, 400, 400, 4,
                   ((track.id % 12) + 1)::text || CASE WHEN track.id % 2 = 0 THEN 'A' ELSE 'B' END,
                   0.85, 8000, (track.duration * 1000)::bigint - 16000,
                   0.6, 0.6, (track.id % 100) / 100.0, 0.7, 0.5,
                   (track.duration * 1000)::bigint, NOW()
            FROM library_tracks track
            WHERE track.artist LIKE :prefix || '-%'
            """
        ),
        params,
    )


def structure_values(track_id: int, duration_ms: int, bpm: float) -> dict[str, Any]:
    """Analyzer v7 structure for a fixture profile: 8-bar phrases from the anchor.

    Phrases cover the track up to its outro cue, the first one an intro and the
    last an outro; energy and voice vary with the phrase and the track so that
    candidates differ. Columns as ``track_mix_profiles`` stores them.
    """
    beat_ms = 60_000.0 / bpm
    phrase_beats = 4 * FIXTURE_PHRASE_BARS
    count = max(
        0,
        min(
            120,
            int(
                (duration_ms - FIXTURE_OUTRO_MS - FIXTURE_ANCHOR_MS)
                // (phrase_beats * beat_ms)
            ),
        ),
    )
    phrases = []
    previous: float | None = None
    for index in range(count):
        energy = round(0.4 + 0.1 * ((index * 7 + track_id) % 5), 3)
        kind = (
            "intro"
            if index == 0
            else "outro"
            if index == count - 1
            else "peak"
            if energy >= 0.8
            else "body"
        )
        phrases.append(
            {
                "start_beat": index * phrase_beats,
                "start_ms": round(FIXTURE_ANCHOR_MS + index * phrase_beats * beat_ms),
                "bars": FIXTURE_PHRASE_BARS,
                "energy": energy,
                "delta_energy": None
                if previous is None
                else round(energy - previous, 3),
                "kind": kind,
            }
        )
        previous = energy
    return {
        "phrases": phrases,
        "energy_curve": bytes(
            round(phrase["energy"] * 255)
            for phrase in phrases
            for _bar in range(FIXTURE_PHRASE_BARS)
        ),
        "vocal_presence": bytes(
            (40 + 37 * (index + track_id)) % 200 for index in range(count)
        ),
        "structure_confidence": 0.5 if phrases else 0.0,
    }


def _add_structure(session, text, name: str) -> None:
    rows = session.execute(
        text(
            """
            SELECT profile.track_id, profile.duration_ms, profile.bpm
            FROM track_mix_profiles profile
            JOIN library_tracks track ON track.id = profile.track_id
            WHERE track.artist LIKE :prefix
            ORDER BY profile.track_id
            """
        ),
        {"prefix": f"{LAB_ARTIST_PREFIX}-{name}-%"},
    ).all()
    for start in range(0, len(rows), STRUCTURE_BATCH):
        batch = rows[start : start + STRUCTURE_BATCH]
        values = [
            structure_values(int(track_id), int(duration_ms), float(bpm))
            for track_id, duration_ms, bpm in batch
        ]
        session.execute(
            text(
                """
                UPDATE track_mix_profiles profile
                SET analyzer_version = 'smart-mix-audio-v7',
                    phrases = CAST(item.phrases AS jsonb),
                    energy_curve = item.energy_curve,
                    vocal_presence = item.vocal_presence,
                    vocal_detector = 'yamnet-2',
                    structure_confidence = item.structure_confidence
                FROM unnest(
                    CAST(:ids AS bigint[]),
                    CAST(:phrases AS text[]),
                    CAST(:curves AS bytea[]),
                    CAST(:voices AS bytea[]),
                    CAST(:confidences AS real[])
                ) AS item(track_id, phrases, energy_curve, vocal_presence,
                          structure_confidence)
                WHERE profile.track_id = item.track_id
                """
            ),
            {
                "ids": [int(row[0]) for row in batch],
                "phrases": [json.dumps(value["phrases"]) for value in values],
                "curves": [value["energy_curve"] for value in values],
                "voices": [value["vocal_presence"] for value in values],
                "confidences": [value["structure_confidence"] for value in values],
            },
        )


def _request() -> SimpleNamespace:
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 1, "role": "admin", "auth_type": "session", "scopes": []}
        )
    )


def _edges(
    uids: list[str], *, start: int, count: int, context: str = "radio"
) -> list[dict[str, Any]]:
    sequence = [uids[(start + offset) % len(uids)] for offset in range(count + 1)]
    return [
        {
            "outgoingTrackEntityUid": sequence[index],
            "incomingTrackEntityUid": sequence[index + 1],
            "context": _context(context),
        }
        for index in range(count)
    ]


def _context(name: str) -> dict[str, Any]:
    context: dict[str, Any] = {
        "source": "radio",
        "automatic": True,
        "offline": False,
        "preferredDurationMs": 8_000,
        "userCueProfile": "default",
        "allowBeatmatch": True,
        "allowTempoAdjustment": True,
    }
    if name == "dj":
        # Crate Decks: long blends and the bass handoff, the largest v3 menu.
        context.update(
            source="playlist",
            preferredDurationMs=12_000,
            allowBassHandoff=True,
            allowLongBeatmatch=True,
        )
    return context


def run(args: argparse.Namespace) -> dict[str, Any]:
    from crate.api import smart_mix
    from crate.api.schemas.smart_mix import TransitionPlanBatchRequest
    from crate.db.cache_runtime import get_redis
    from crate.db.tx import read_scope
    from crate.smart_mix.versions import PLANNER_IDENTIFIER
    from sqlalchemy import text

    uids = seed_fixture(args.fixture)
    shuffled = list(uids)
    if args.edge_order == "shuffled":
        random.Random(7).shuffle(shuffled)
    request = _request()

    def plans(edges: list[dict[str, Any]]) -> None:
        smart_mix.transition_plans(
            request,
            TransitionPlanBatchRequest.model_validate(
                {"plannerVersion": args.planner, "edges": edges}
            ),
        )

    def edges(start: int) -> list[dict[str, Any]]:
        return _edges(shuffled, start=start, count=32, context=args.context)

    cached_edges = edges(0)
    plans(cached_edges)
    scenarios = {
        "cached_batch32": measure(
            lambda _index: plans(cached_edges),
            warmup=args.warmup,
            iterations=args.iterations,
            concurrency=args.concurrency,
        ),
        "uncached_batch32": measure(
            lambda index: plans(edges(33 + index * 33)),
            warmup=args.warmup,
            iterations=args.iterations,
            concurrency=args.concurrency,
        ),
        "compatible500": measure(
            lambda index: smart_mix.compatible_tracks(
                request,
                shuffled[index % len(shuffled)],
                scope="local",
                limit=20,
                planner_version=PLANNER_IDENTIFIER,
            ),
            warmup=args.warmup,
            iterations=args.iterations,
            concurrency=args.concurrency,
        ),
    }
    with read_scope() as session:
        postgres_version = session.execute(text("SHOW server_version")).scalar_one()
    return {
        "kind": "server",
        "command": " ".join(sys.argv),
        "commit": _git("rev-parse", "HEAD"),
        "dirty": bool(_git("status", "--porcelain")),
        "environment": {
            "hardware": {
                "machine": platform.machine(),
                "processor": platform.processor(),
                "cpus": os.cpu_count(),
                "platform": platform.platform(),
            },
            "versions": {
                "python": platform.python_version(),
                "postgres": postgres_version,
            },
            "redis": _redis_reachable(get_redis()),
            "note": args.note,
        },
        "dataset": {
            "fixture": args.fixture,
            "tracks": len(uids),
            "planner": args.planner,
            "context": args.context,
            "edgeOrder": args.edge_order,
        },
        "warmup": args.warmup,
        "iterations": args.iterations,
        "concurrency": args.concurrency,
        "scenarios": {name: summarize(samples) for name, samples in scenarios.items()},
        "suites": {"rust_parity": args.rust_parity},
    }


def _redis_reachable(client: Any) -> bool:
    if client is None:
        return False
    try:
        return bool(client.ping())
    except Exception:
        return False


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=False
    ).stdout.strip()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dsn", default=os.environ.get("SMART_MIX_LAB_DSN"), required=False
    )
    parser.add_argument(
        "--fixture", choices=sorted(FIXTURES), default="representative-48k"
    )
    parser.add_argument("--planner", choices=PLANNERS, default=PLANNERS[0])
    parser.add_argument("--context", choices=("radio", "dj"), default="radio")
    parser.add_argument(
        "--edge-order",
        choices=("shuffled", "sequential"),
        default="shuffled",
        help=(
            "sequential plans tracks in id order, one BPM apart in the fixture, so "
            "most edges beatmatch; shuffled pairs random tempos"
        ),
    )
    parser.add_argument("--warmup", type=int, default=100)
    parser.add_argument("--iterations", type=int, default=1_000)
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--migrate", action="store_true")
    parser.add_argument("--rust-parity", default="not-run")
    parser.add_argument("--note", default="")
    parser.add_argument("--allow-non-test-database", action="store_true")
    args = parser.parse_args(argv)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_LAB_DSN is required")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    os.environ.update(
        check_isolated_dsn(args.dsn, allow_non_test=args.allow_non_test_database)
    )
    sys.path.insert(0, str(APP_ROOT))
    if args.migrate:
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=APP_ROOT,
            check=True,
            env=os.environ.copy(),
        )
    artifact = run(args)
    args.output.write_text(json.dumps(artifact, indent=2) + "\n")
    print(json.dumps(artifact["scenarios"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
