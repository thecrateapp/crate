"""Replay pinned Music Paths regression fixtures for H11, without SQL or network.

Run from the repo root: python3 app/web/scripts/export_music_path_fixture.py [--check].
The original Python functions execute unchanged. Crate imports are omitted from
isolated namespaces and injected with pinned pure functions or declared fixture
adapters. This is not production retrieval, a benchmark or a port of the planner.
"""
from __future__ import annotations

import argparse
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

PIN = "f602d82dd3253380234b68aadc5948b303b6803f"
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "app/web/src/data/blog-music-path-fixture.json"
TEST_FILE = "app/tests/test_music_paths_fallback.py"
FILES = ["app/crate/track_versions.py", "app/crate/db/paths_vectors.py",
         "app/crate/db/paths_similarity.py", "app/crate/db/paths_candidates.py",
         "app/crate/db/paths_path_builder.py", TEST_FILE]


def _sources():
    return {path: subprocess.check_output(["git", "show", f"{PIN}:{path}"], cwd=ROOT, text=True) for path in FILES}


def _load(path, sources, bindings=None, only=None):
    tree = ast.parse(sources[path], filename=path)
    if only:
        tree.body = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in only]
    else:
        tree.body = [node for node in tree.body if not (
            isinstance(node, ast.ImportFrom) and (node.module or "").startswith("crate")
        )]
    namespace = {"__name__": "blog_pinned_" + Path(path).stem, **(bindings or {})}
    exec(compile(tree, f"{PIN}:{path}", "exec"), namespace)
    return namespace


def _case(case_id, row, versions, vectors, similarity, sources):
    if case_id == "complete":
        origin, destination = row(1), row(2)
        rows = [destination, row(3), row(4), row(5)]
        requested, label = 5, "Complete route"
        test = "test_destination_is_reserved_before_selecting_middle_tracks"
    elif case_id == "family":
        origin, destination = row(1, title="Origin"), row(2, title="Destination")
        rows = [row(3, artist=destination["artist"], title="Destination (Live)"), row(4, vector=[-0.2] * 20)]
        requested, label = 5, "Reserved song family"
        test = "test_reserved_song_families_cannot_reappear_as_middle_versions[destination]"
    else:
        origin, destination = row(1), row(2)
        rows = [destination]
        requested, label = 20, "Sparse catalogue"
        test = "test_sparse_catalog_keeps_both_endpoints_without_inventing_middle_tracks"
    identity = versions["track_song_identity"]
    catalog = {r["id"]: r for r in [origin, destination, *rows]}
    trace, anchors, active = [], [], None

    def anchor_query(kind, value, target, exclude, **kwargs):
        found = {str(origin["id"]): origin, str(destination["id"]): destination}.get(value)
        return deepcopy(found) if found and found["id"] not in exclude else None

    def candidate_query(target, excluded, *, limit, **kwargs):
        found = deepcopy([r for r in rows if r["id"] not in excluded][:limit])
        active["retrievedIds"].extend(r["id"] for r in found)
        return found

    candidates = _load("app/crate/db/paths_candidates.py", sources, {
        "track_song_identity": identity, "find_anchor_track_row": anchor_query,
        "find_candidate_rows": candidate_query,
    })

    def select(*args, **kwargs):
        nonlocal active
        active = {"step": len(trace) + 1, "excludedIds": sorted(args[1]), "retrievedIds": [],
                  "excludedFamilies": [list(key) for key in sorted(kwargs.get("exclude_song_keys") or set())]}
        found = candidates["_find_best_candidate"](*args, **kwargs)
        active["retrievedIds"] = list(dict.fromkeys(active["retrievedIds"]))
        active["familyExcludedIds"] = [i for i in active["retrievedIds"] if identity(catalog[i]) in (kwargs.get("exclude_song_keys") or set())]
        active["selectedId"] = found["id"] if found else None
        active["selectedDistance"] = found["distance"] if found else None
        trace.append(deepcopy(active))
        return found

    builder = _load("app/crate/db/paths_path_builder.py", sources, {
        "_find_anchor_track": candidates["_find_anchor_track"], "_find_best_candidate": select,
        "_load_artist_similarity_graph": lambda: {}, "_load_artist_genres": lambda: {},
        "_load_shared_members_graph": lambda: {}, "_artist_affinity": similarity["_artist_affinity"],
        "make_path_genre_overlap_scorer": similarity["make_path_genre_overlap_scorer"],
        "load_endpoint_contexts": lambda *args, **kwargs: [{"artists": [r["artist"]], "genre_weights": {}, "genre_signals": []} for r in (origin, destination)],
        "_lerp": vectors["_lerp"], "track_song_identity": identity,
    })
    resolve = builder["_resolve_path_anchors"]

    def capture_anchors(*args, **kwargs):
        pair = resolve(*args, **kwargs)
        anchors.extend(r["id"] if r else None for r in pair)
        return pair

    builder["_resolve_path_anchors"] = capture_anchors
    result = builder["compute_path"]("track", str(origin["id"]), origin["bliss_vector"],
        "track", str(destination["id"]), destination["bliss_vector"], requested)
    ids = [r["track_id"] for r in result]
    pool_ids = list(dict.fromkeys(r["id"] for r in rows))

    def event(kind, description, selected, *, focus=0, attempt=None, attempt_count=0):
        candidates_view = []
        if attempt:
            for i in pool_ids:
                status = "Reserved destination" if i == destination["id"] and i in attempt["excludedIds"] else (
                    "Already selected" if i in attempt["excludedIds"] else "Reserved song family" if i in attempt["familyExcludedIds"] else (
                        "Selected" if i == attempt["selectedId"] else "Available" if i in attempt["retrievedIds"] else "Not retrieved"))
                candidates_view.append({"id": i, "status": status})
        return {"kind": kind, "description": description, "selectedIds": list(selected),
                "reservedIds": [destination["id"]] if kind not in {"request", "finish"} else [],
                "focusStep": focus, "attemptCount": attempt_count, "candidates": candidates_view}

    events = [event("request", f"Request {requested} tracks, including the origin and destination.", []),
        event("anchors", "Resolve both anchors. Reserve the destination ID, title and song family before selecting any middle track.", [anchors[0]])]
    selected = [anchors[0]]
    index = 0
    while index < len(trace):
        attempt = trace[index]
        if attempt["selectedId"] is not None:
            selected.append(attempt["selectedId"])
            events.append(event("selection", f"Middle step {attempt['step']}: select track #{attempt['selectedId']} from the fixture pool. The destination stays reserved.", selected, focus=attempt["step"], attempt=attempt, attempt_count=1))
            index += 1
        else:
            end = index + 1
            while end < len(trace) and trace[end]["selectedId"] is None and trace[end]["excludedIds"] == attempt["excludedIds"] and trace[end]["retrievedIds"] == attempt["retrievedIds"]:
                end += 1
            count = end - index
            events.append(event("exhausted", f"{count} middle selection attempt{'s' if count != 1 else ''} returned no track. Reserved or ineligible recordings do not fill the missing steps.", selected, focus=trace[end - 1]["step"], attempt=attempt, attempt_count=count))
            index = end
    events.append(event("finish", f"Return {len(ids)} of {requested} requested tracks, with both endpoints retained. " + ("The requested length is complete; this does not judge how the route sounds." if len(ids) == requested else "The route is shorter than requested; no intermediate songs are invented."), ids, focus=requested - 1))
    test_node = next(node for node in ast.parse(sources[TEST_FILE]).body if isinstance(node, ast.FunctionDef) and node.name == test.split("[")[0])
    return {"id": case_id, "label": label, "test": test, "testStart": test_node.lineno, "testEnd": test_node.end_lineno, "requested": requested,
        "originId": origin["id"], "destinationId": destination["id"], "resultIds": ids,
        "resultSteps": [{"id": r["track_id"], "step": r["step"], "progress": r["progress"]} for r in result],
        "catalog": [{"id": r["id"], "artist": r["artist"], "title": r["title"], "family": list(identity(r))} for r in catalog.values()],
        "attempts": trace, "events": events}


def build_fixture():
    sources = _sources()
    versions = _load("app/crate/track_versions.py", sources)
    vectors = _load("app/crate/db/paths_vectors.py", sources)
    similarity = _load("app/crate/db/paths_similarity.py", sources)
    row = _load(TEST_FILE, sources, only={"_row"})["_row"]
    return {"source": {"commit": PIN, "testFile": TEST_FILE,
        "sha256": {path: hashlib.sha256(text.encode()).hexdigest() for path, text in sources.items()},
        "execution": "Pinned Python builder, selector/scorer, interpolation and song identity. Fixed in-memory retrieval, empty relationship/genre graphs and explicit endpoint contexts; no SQL, production music or network."},
        "cases": [_case(key, row, versions, vectors, similarity, sources) for key in ("complete", "family", "sparse")]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)
    text = json.dumps(build_fixture(), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text() != text:
            print("Music Paths fixture differs; run the exporter to regenerate it.", file=sys.stderr)
            return 1
        print("Music Paths fixture matches the pinned Python execution.")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
        print(f"Wrote {args.output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
