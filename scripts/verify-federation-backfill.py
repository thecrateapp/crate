#!/usr/bin/env python3
"""Report and optionally resume the canonical user-reference backfill."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from crate.db.core_provisioning import confirm_database_target
from crate.db.repositories.global_user_library import (
    backfill_legacy_user_library_refs_batch,
    finalize_user_library_refs_backfill,
)
from crate.federation.backfill_verification import collect_federation_backfill_report


COUNTERS = (
    "artist_follows",
    "album_saves",
    "track_likes",
    "playlist_tracks",
    "playlist_track_exclusions",
    "play_events",
    "listening_stats_users",
)


def _load_checkpoint(path: Path) -> dict:
    if not path.exists():
        return {"cursor": None, "report": {name: 0 for name in COUNTERS}}
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict) or not isinstance(payload.get("report"), dict):
        raise ValueError("Invalid federation backfill checkpoint")
    return payload


def _write_checkpoint(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def _apply(batch_size: int, checkpoint_path: Path) -> dict:
    checkpoint = _load_checkpoint(checkpoint_path)
    cursor = checkpoint.get("cursor")
    report = {name: int(checkpoint["report"].get(name) or 0) for name in COUNTERS}
    while True:
        batch = backfill_legacy_user_library_refs_batch(
            batch_size=batch_size,
            cursor=int(cursor) if cursor is not None else None,
            rebuild_listening_stats=True,
        )
        for name in COUNTERS:
            report[name] += int(batch.get(name) or 0)
        cursor = batch.get("next_cursor")
        _write_checkpoint(
            checkpoint_path,
            {
                "cursor": cursor,
                "report": report,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        print(
            f"users={batch['users_processed']} next_cursor={cursor} "
            f"completed={batch['completed']}",
            file=sys.stderr,
        )
        if batch["completed"]:
            finalized = finalize_user_library_refs_backfill(report)
            checkpoint_path.unlink(missing_ok=True)
            return finalized


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True)
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-database")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path(".federation-backfill-state.json"),
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    before = collect_federation_backfill_report()
    applied = None
    if args.apply:
        confirm_database_target(args.confirm_database or "")
        applied = _apply(max(1, min(args.batch_size, 1000)), args.checkpoint)
    after = collect_federation_backfill_report()
    payload = {
        "mode": "apply" if args.apply else "dry-run",
        "before": before,
        "applied": applied,
        "after": after,
        "legacy_invariants_preserved": (
            before["legacy_invariants"] == after["legacy_invariants"]
        ),
    }
    encoded = json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
    print(encoded, end="")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    return 0 if payload["legacy_invariants_preserved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
