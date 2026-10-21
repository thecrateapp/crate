#!/usr/bin/env python3
"""Package one committed source candidate; does not approve images or activate anything."""

import argparse
import hashlib
import json
import subprocess
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.hermes_context import build_context


def build(repo, revision, destination):
    actual = subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", revision + "^{commit}"], text=True
    ).strip()
    if revision != actual or destination.exists():
        raise ValueError("Exact committed SHA and absent destination required")
    destination.mkdir(parents=True)
    # This source-only candidate has no invented image digests or deployment proof.
    deployment = {"release_sha": revision, "state": "unverified", "images": {}}
    build_context(repo, revision, destination / "context", deployment)
    with tarfile.open(destination / "context.tar.gz", "w:gz") as archive:
        archive.add(destination / "context", arcname=".")
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "archive",
            "--format=tar",
            "--output=" + str(destination / "source.tar"),
            revision,
        ],
        check=True,
    )
    hashes = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (
            destination / "source.tar",
            destination / "context.tar.gz",
            destination / "context/context-manifest.json",
        )
    }
    result = {
        "release_sha": revision,
        "state": "source_candidate_only",
        "activated": False,
        "image_evidence": "requires immutable release manifest from successful CI builds",
        "sha256": hashes,
    }
    (destination / "candidate.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    print(
        json.dumps(
            build(Path(__file__).resolve().parents[1], args.revision, args.destination)
        )
    )


if __name__ == "__main__":
    main()
