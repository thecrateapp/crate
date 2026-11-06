#!/usr/bin/env python3
"""Convert Google's YAMNet weights into the .npz that crate.smart_mix.voice_model loads.

Usage: convert_yamnet_weights.py yamnet.h5 yamnet_class_map.csv yamnet.npz

``yamnet.h5`` and ``yamnet_class_map.csv`` are Google's originals (tensorflow/models,
research/audioset/yamnet, Apache-2.0). Keras stores each variable as
``<layer>/<layer>/<name>:0``; the archive keeps ``<layer>/<name>`` and adds the class
names. Needs h5py and numpy; app/Dockerfile runs it once in a build stage, so the
analysis image needs neither h5py nor TensorFlow.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np

EXPECTED_TENSORS = 110
EXPECTED_CLASSES = 521


def archive_key(dataset_path: str) -> str:
    parts = dataset_path.removesuffix(":0").split("/")
    depth = (len(parts) - 1) // 2
    return "/".join([*parts[:depth], parts[-1]])


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.splitlines()[2], file=sys.stderr)
        return 2
    import h5py

    weights_path, class_map_path, output_path = (Path(arg) for arg in argv)
    weights: dict[str, np.ndarray] = {}
    with h5py.File(weights_path, "r") as handle:

        def collect(name: str, item) -> None:
            if isinstance(item, h5py.Dataset):
                weights[archive_key(name)] = np.asarray(item, dtype=np.float32)

        handle.visititems(collect)
    with class_map_path.open(newline="") as handle:
        names = [row["display_name"] for row in csv.DictReader(handle)]
    if len(weights) != EXPECTED_TENSORS or len(names) != EXPECTED_CLASSES:
        print(
            f"unexpected YAMNet files: {len(weights)} tensors, {len(names)} classes",
            file=sys.stderr,
        )
        return 1
    np.savez(output_path, class_names=np.array(names), **weights)
    print(f"{len(weights)} tensors and {len(names)} classes -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
