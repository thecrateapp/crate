#!/usr/bin/env python3
"""Export Smart Mix phrases to label voice presence by hand (gate SG1).

Reads the stored v7 phrases of the given tracks from a development database and writes
one row per phrase to ``tools/smart-mix-eval/vocals_labels.csv`` with an empty ``vocal``
column, for a person to fill with 1 (voice) or 0 (no voice). The CSV holds entity UIDs
and times only; titles are printed to the console for whoever listens. Labels already
given are kept when a track is exported again and its phrase did not move.

With ``--score`` it also decodes each track and writes the detector's byte per phrase to
``vocals_scores.csv``, a separate file so the labeller does not see it.
``app/tests/test_smart_mix_vocals.py::test_precision_recall_on_labelled_set`` compares
both files against the design's thresholds.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[3]
APP_ROOT = REPO_ROOT / "app"
DEFAULT_LABELS = REPO_ROOT / "tools/smart-mix-eval/vocals_labels.csv"
DEFAULT_SCORES = REPO_ROOT / "tools/smart-mix-eval/vocals_scores.csv"
LABEL_FIELDS = (
    "entity_uid",
    "phrase_index",
    "start_ms",
    "end_ms",
    "bars",
    "kind",
    "vocal",
)
SCORE_FIELDS = (
    "entity_uid",
    "phrase_index",
    "start_ms",
    "vocal_score",
    "detector_version",
)
DSN_ENVIRONMENT_VARIABLE = "SMART_MIX_EVAL_DSN"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
ANALYSIS_SAMPLE_RATE = 22_050


class UnsafeDatabaseError(RuntimeError):
    pass


def database_environment(dsn: str, *, allow_remote: bool) -> dict[str, str]:
    """Crate's ``CRATE_POSTGRES_*`` variables for a local DSN, with read-only sessions."""
    parsed = urlparse(dsn)
    if parsed.scheme not in {"postgresql", "postgres"} or not parsed.path.strip("/"):
        raise UnsafeDatabaseError("The DSN must be a postgresql:// URL with a database")
    host = parsed.hostname or ""
    if host not in LOOPBACK_HOSTS and not allow_remote:
        raise UnsafeDatabaseError(
            f"Refusing a database that is not on this machine (host={host!r}). This "
            "tool reads a development library; any other database needs Diego's "
            "explicit authorization and --allow-remote-database."
        )
    return {
        "CRATE_POSTGRES_USER": parsed.username or "crate",
        "CRATE_POSTGRES_PASSWORD": parsed.password or "",
        "CRATE_POSTGRES_HOST": host,
        "CRATE_POSTGRES_PORT": str(parsed.port or 5432),
        "CRATE_POSTGRES_DB": parsed.path.strip("/"),
        # libpq applies it to every connection: PostgreSQL rejects any write.
        "PGOPTIONS": "-c default_transaction_read_only=on",
    }


def read_track_uids(values: Iterable[str], tracks_file: Path | None) -> list[str]:
    """Entity UIDs from the arguments, then the file (one per line, # comments)."""
    lines = list(values)
    if tracks_file is not None:
        lines.extend(tracks_file.read_text().splitlines())
    uids: list[str] = []
    for line in lines:
        uid = line.split("#", 1)[0].strip()
        if uid and uid not in uids:
            uids.append(uid)
    return uids


def phrase_rows(
    entity_uid: str, phrases: Sequence[Any], beat_grid_ms: Sequence[int]
) -> list[dict[str, Any]]:
    from crate.smart_mix.vocals import phrase_spans_ms

    return [
        {
            "entity_uid": entity_uid,
            "phrase_index": index,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "bars": phrase.bars,
            "kind": phrase.kind,
            "vocal": "",
        }
        for index, (phrase, (start_ms, end_ms)) in enumerate(
            zip(phrases, phrase_spans_ms(phrases, beat_grid_ms), strict=True)
        )
    ]


def stored_phrase_rows(
    entity_uid: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """The track and one row per stored phrase, or None without v7 phrases.

    Needs Crate's database variables (``database_environment``) and ``app`` on the path.
    """
    from crate.db.jobs.analysis_storage import resolve_smart_mix_track
    from crate.db.repositories.smart_mix import get_track_mix_profile_by_entity_uid

    track = resolve_smart_mix_track(track_entity_uid=entity_uid)
    profile = get_track_mix_profile_by_entity_uid(
        entity_uid, include_beat_grid=True, include_structure=True
    )
    if track is None or profile is None or not profile.phrases:
        return None
    return track, phrase_rows(entity_uid, profile.phrases, profile.beat_grid_ms)


def merge_rows(
    existing: Sequence[dict[str, Any]],
    fresh: Sequence[dict[str, Any]],
    *,
    replaced: set[str],
) -> list[dict[str, Any]]:
    """Keep other tracks' rows; give re-exported phrases their label if they did not move."""

    def key(row: dict[str, Any]) -> tuple[str, int, int]:
        return (str(row["entity_uid"]), int(row["phrase_index"]), int(row["start_ms"]))

    labels = {key(row): row.get("vocal", "") for row in existing}
    kept = [row for row in existing if str(row["entity_uid"]) not in replaced]
    return kept + [{**row, "vocal": labels.get(key(row), "")} for row in fresh]


def read_csv(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(
    path: Path, fields: Sequence[str], rows: Iterable[dict[str, Any]]
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def local_path(path: str, library_root: str, music_root: Path | None) -> Path:
    if music_root is None or not path.startswith(library_root.rstrip("/") + "/"):
        return Path(path)
    return music_root / path[len(library_root.rstrip("/")) + 1 :]


def _clock(ms: int) -> str:
    return f"{ms // 60_000}:{ms % 60_000 / 1_000:04.1f}"


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("tracks", nargs="*", help="Track entity UIDs")
    parser.add_argument("--tracks-file", type=Path, help="One entity UID per line")
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    parser.add_argument("--scores", type=Path, default=DEFAULT_SCORES)
    parser.add_argument(
        "--score",
        action="store_true",
        help="Also decode each track and write the detector bytes to --scores",
    )
    parser.add_argument("--dsn", default=os.environ.get(DSN_ENVIRONMENT_VARIABLE))
    parser.add_argument("--allow-remote-database", action="store_true")
    parser.add_argument(
        "--library-root",
        default="/music",
        help="Prefix of the paths stored in the database (default /music)",
    )
    parser.add_argument(
        "--music-root",
        type=Path,
        help="Local folder that holds --library-root, to decode audio with --score",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    uids = read_track_uids(args.tracks, args.tracks_file)
    if not uids:
        print("No tracks given.", file=sys.stderr)
        return 2
    if not args.dsn:
        print(f"Set --dsn or {DSN_ENVIRONMENT_VARIABLE}.", file=sys.stderr)
        return 2
    os.environ.update(
        database_environment(args.dsn, allow_remote=args.allow_remote_database)
    )
    if str(APP_ROOT) not in sys.path:
        sys.path.insert(0, str(APP_ROOT))
    from crate.smart_mix.vocals import VOCAL_DETECTOR_VERSION, phrase_vocal_presence

    labels: list[dict[str, Any]] = []
    scores: list[dict[str, Any]] = []
    exported: set[str] = set()
    for uid in uids:
        stored = stored_phrase_rows(uid)
        if stored is None:
            print(f"{uid}  skipped: no stored phrases (analyze it with v7 first)")
            continue
        track, rows = stored
        print(f"{uid}  {track.get('artist') or '?'} - {track.get('title') or '?'}")
        for row in rows:
            print(
                f"  #{row['phrase_index']:<3} {_clock(row['start_ms'])}-"
                f"{_clock(row['end_ms'])}  {row['bars']:>2} bars  {row['kind']}"
            )
        labels.extend(rows)
        exported.add(uid)
        if args.score:
            import librosa

            audio, _ = librosa.load(
                local_path(track["path"], args.library_root, args.music_root),
                sr=ANALYSIS_SAMPLE_RATE,
                mono=True,
            )
            presence = phrase_vocal_presence(
                audio,
                ANALYSIS_SAMPLE_RATE,
                [(row["start_ms"], row["end_ms"]) for row in rows],
            )
            scores.extend(
                {
                    **row,
                    "vocal_score": score,
                    "detector_version": VOCAL_DETECTOR_VERSION,
                }
                for row, score in zip(rows, presence, strict=True)
            )

    write_csv(
        args.labels,
        LABEL_FIELDS,
        merge_rows(read_csv(args.labels), labels, replaced=exported),
    )
    print(f"{len(labels)} phrases from {len(exported)} tracks in {args.labels}")
    if args.score:
        write_csv(
            args.scores,
            SCORE_FIELDS,
            merge_rows(read_csv(args.scores), scores, replaced=exported),
        )
        print(f"Detector bytes in {args.scores}")
    print("Fill the vocal column with 1 (voice) or 0 (no voice).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
