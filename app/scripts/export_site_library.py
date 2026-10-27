"""Offline, read-only export of the library cloud used by the website hero."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from crate.db.queries.site_library_sample import get_bliss_sample


def project_to_3d(vectors: np.ndarray, radius: float) -> np.ndarray:
    centred = vectors - vectors.mean(axis=0)
    _, _, components = np.linalg.svd(centred, full_matrices=False)
    points = centred @ components[:3].T
    points -= points.mean(axis=0)
    scale = np.percentile(np.abs(points), 99.5) or 1.0
    return np.clip(points / scale * radius, -radius, radius)


def quantise(points: np.ndarray, radius: float) -> np.ndarray:
    return np.round(points.reshape(-1) / radius * 32767).astype(np.int16)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=40000)
    parser.add_argument("--min", type=int, default=12000)
    parser.add_argument("--seed", type=float, default=0.42)
    parser.add_argument("--radius", type=float, default=1.5)
    parser.add_argument("--out", type=Path, default=Path("web/public/data"))
    args = parser.parse_args(argv)

    rows = get_bliss_sample(limit=args.limit, seed=args.seed)
    if not rows:
        raise SystemExit("no tracks with bliss vectors found")
    if len(rows) < args.min:
        raise SystemExit(
            f"only {len(rows)} tracks with bliss vectors; the hero needs at least {args.min}"
        )
    vectors = np.array([row["bliss_vector"] for row in rows], dtype=np.float64)
    points = project_to_3d(vectors, args.radius)

    args.out.mkdir(parents=True, exist_ok=True)
    quantise(points, args.radius).tofile(args.out / "library-cloud.bin")
    (args.out / "library-cloud.json").write_text(
        json.dumps({"count": len(rows), "radius": args.radius, "seed": args.seed})
    )
    print(f"wrote {len(rows)} points to {args.out}")


if __name__ == "__main__":
    main()
