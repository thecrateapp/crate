"""Score crate-cli outputs against the offline Mixxx references (Queen Mary beats/key,
KeyFinder key) and a waveform kick-attack reference. Pure Python.

usage: evaluate.py <scratch> <variant-dir> [<variant-dir> ...]
"""

import json
import statistics
import sys
from collections import Counter
from pathlib import Path

root = Path(sys.argv[1])
FULL_CSV = [
    "62654024-d52e-5523-a386-05b9c424c4bb",
    "e71c8c68-42d0-5d34-99cd-49c223d78e76",
    "c7709c78-5064-5c1c-8f85-2c5c720c9b5f",
    "3ccf98d0-53c3-5235-9122-98ef5f349d89",
    "b4533240-9708-5577-aeb3-1926a5e224fc",
    "11bb8d08-df9f-5e37-b7f9-2009d581503d",
    "aa3b1640-57a2-5d1c-b985-12f1b71dc65b",
    "2dbb326e-da09-5a4c-9edc-ff0ae5ec9187",
    "2a4f222b-e433-534f-b40d-e6a7ad221aa2",
    "60852b5f-0050-5680-9e73-e660e3b4431a",
]


def load(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def closest_on_grid(position, first, period):
    return position - (first + round((position - first) / period) * period)


def spread_probe(grid, mixxx_first, mixxx_period):
    """The spike harness metric: five Crate beats spread over the track against the
    closest beat of Mixxx's constant grid; returns the max |difference| in ms."""
    if len(grid) < 12:
        return None
    probes = [grid[i * len(grid) // 6] for i in range(1, 6)]
    return max(abs(closest_on_grid(p, mixxx_first, mixxx_period)) for p in probes)


def key_scores(rows):
    kf = [r["kf"] for r in rows]
    qm = [r["qm"] for r in rows]
    pred = [r["crate"] for r in rows]
    consensus = [i for i, (a, b) in enumerate(zip(kf, qm)) if a == b]
    top3 = sum(n for _, n in Counter(pred).most_common(3)) / len(pred)
    return {
        "tracks": len(rows),
        "agree_keyfinder": sum(p == k for p, k in zip(pred, kf)) / len(rows),
        "agree_queen_mary": sum(p == q for p, q in zip(pred, qm)) / len(rows),
        "consensus_tracks": len(consensus),
        "consensus_accuracy": sum(pred[i] == kf[i] for i in consensus)
        / max(1, len(consensus)),
        "top3_share": top3,
        "distinct": len(set(pred)),
        "top": Counter(pred).most_common(3),
    }


def grid_rows(variant, subset, names):
    rows = []
    for name in names:
        ref = load(root / ("ref" if subset == "spike" else "tm/ref") / f"{name}.json")
        out = load(variant / subset / f"{name}.json")
        if not ref or not out or not out.get("mixProfile"):
            continue
        profile = out["mixProfile"]
        period = 60_000.0 / ref["bpm"]
        rows.append(
            {
                "name": name,
                "mixxx_bpm": ref["bpm"],
                "crate_bpm": profile.get("bpm"),
                "quality": profile.get("quality"),
                "probe": spread_probe(
                    profile.get("beatGridMs") or [], ref["firstBeatMs"], period
                ),
                "kf": ref["keyfinderKey"],
                "qm": ref["qmKey"],
                "crate": profile.get("camelot"),
            }
        )
    return rows


def bpm_summary(rows):
    integer_ref = [
        r
        for r in rows
        if r["crate_bpm"] and abs(r["mixxx_bpm"] - round(r["mixxx_bpm"])) < 1e-6
    ]
    exact = sum(abs(r["crate_bpm"] - r["mixxx_bpm"]) < 0.0005 for r in integer_ref)
    within = sum(
        abs(r["crate_bpm"] - r["mixxx_bpm"]) <= 0.02 for r in rows if r["crate_bpm"]
    )
    probes = [r["probe"] for r in rows if r["probe"] is not None]
    return {
        "tracks": len(rows),
        "mixxx_integer_tracks": len(integer_ref),
        "crate_equal_on_those": exact,
        "within_0.02_bpm_of_mixxx": within,
        "probe_median_ms": statistics.median(probes) if probes else None,
        "probe_within_5ms": sum(p <= 5 for p in probes),
        "probe_within_30ms": sum(p <= 30 for p in probes),
        "full": sum(r["quality"] == "full" for r in rows),
    }


tm_names = sorted(p.stem for p in (root / "tm" / "ref").glob("*.json"))
for arg in sys.argv[2:]:
    variant = Path(arg)
    print(f"== {variant.name}")
    tm_rows = grid_rows(variant, "tm", tm_names)
    print(" key, test-music:", json.dumps(key_scores(tm_rows)))
    print(" tempo, test-music:", json.dumps(bpm_summary(tm_rows)))
    spike_rows = grid_rows(variant, "spike", FULL_CSV)
    print(" tempo, spike full-10:", json.dumps(bpm_summary(spike_rows)))
    for r in spike_rows:
        print(
            f"   {r['name'][:8]} mixxx {r['mixxx_bpm']:8.3f} crate {r['crate_bpm']:8.3f} probe {r['probe']:6.1f} ms {r['quality']:8s} key {r['crate']:>3s} (qm {r['qm']}, kf {r['kf']})"
        )
