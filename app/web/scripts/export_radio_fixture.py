"""Export H31's synthetic selector traces using pinned Python, without app services.

The selector, identity, significance and delivery-ledger bodies are unchanged.
Fixed candidate rows/distances and acoustic-only weights isolate rotation, as in
test_radio_final_rotation._ranked_catalog. This does not run full batch generation,
SQL retrieval, artist-limit relaxation, Redis or the history query.
"""
from __future__ import annotations

import argparse
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys

PIN = "924b7fb6d08e0a9a80a8241ed41786aa7a770824"
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "app/web/src/data/blog-radio-fixture.json"
ENGINE = "app/crate/radio_engine.py"
TEST = "app/tests/test_radio_final_rotation.py"
FILES = [ENGINE, "app/crate/track_versions.py", "app/crate/queue_engine.py",
         "app/crate/recommendation_policy.py", "app/crate/db/paths_candidates.py",
         "app/crate/db/paths_similarity.py", "app/tests/test_radio_delivery_memory.py", TEST]


def _load(path, sources, bindings=None, functions=None):
    tree = ast.parse(sources[path], filename=path)
    if functions is None:
        tree.body = [node for node in tree.body if not (
            isinstance(node, ast.ImportFrom) and (node.module or "").startswith("crate")
        )]
    else:
        tree.body = [node for node in tree.body if (
            isinstance(node, (ast.Import, ast.ImportFrom))
            and not (isinstance(node, ast.ImportFrom) and (node.module or "").startswith(("crate", "tests")))
        ) or (isinstance(node, ast.FunctionDef) and node.name in functions)
        or (isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id.isupper() for t in node.targets))]
    namespace = {"__name__": "blog_radio_" + Path(path).stem, **(bindings or {})}
    exec(compile(tree, f"{PIN}:{path}", "exec"), namespace)
    return namespace


def _location(source, name):
    node = next(n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == name)
    return {"start": node.lineno, "end": node.end_lineno}


def build_fixture():
    sources = {p: subprocess.check_output(["git", "show", f"{PIN}:{p}"], cwd=ROOT, text=True) for p in FILES}
    versions = _load("app/crate/track_versions.py", sources)
    policy = _load("app/crate/recommendation_policy.py", sources, {"track_song_identity": versions["track_song_identity"]})
    queue = _load("app/crate/queue_engine.py", sources, versions, {
        "_payload", "_value", "_normalise_text", "candidate_artist_key", "candidate_title", "candidate_song_key"})
    penalties = _load("app/crate/db/paths_candidates.py", sources)
    similarity = _load("app/crate/db/paths_similarity.py", sources)
    radio = _load(ENGINE, sources, {
        **versions, **penalties, "canonical_key": policy["canonical_key"],
        "shared_candidate_artist_key": queue["candidate_artist_key"],
        "shared_candidate_song_key": queue["candidate_song_key"],
        "_artist_affinity": similarity["_artist_affinity"],
    }, {"_select_radio_candidate_from_rows", "_title_key", "_artist_key", "_song_key",
        "_delivered_song_keys", "_record_delivered_songs", "_seeded_radio_source_penalty"})
    # Explicit fixture adapter, matching _ranked_catalog's isolated scoring weights.
    radio["_seeded_radio_weights"] = lambda _profile: (1.0, 0.0, 0.0)
    row = _load("app/tests/test_radio_delivery_memory.py", sources, functions={"_row"})["_row"]
    canonical = policy["canonical_key"]

    def make_rows(listening=False):
        specs = [(1, "A", "Song" if listening else "Delivered X", 0.10),
                 (3 if listening else 2, "B", "Fresh", 0.14 if listening else 0.40),
                 (4 if listening else 3, "C", "Far", 1.0)]
        if listening:
            specs.insert(1, (2, "A", "Song (Live)", 0.12))
        return [dict(row(i, artist=artist, title=title), bliss_vector=None, distance=distance, duration=180)
                for i, artist, title, distance in specs]

    def run(case_id, label):
        rows = make_rows(case_id == "listen")
        catalog = deepcopy(rows)
        session, history, buffer, events = {}, {}, [], []
        play = None

        def inspect():
            ranked = []
            selected = radio["_select_radio_candidate_from_rows"](
                deepcopy(rows), [0.2] * 20, {r["id"] for r in buffer},
                {radio["_title_key"](r) for r in buffer},
                {radio["_song_key"](r) for r in buffer}, None, None, [], {}, {}, {}, ["Seed"],
                artist_affinity_cache={}, genre_overlap_cache={}, genre_overlap=lambda *_a: 0.0,
                radio_profile="track", rotation_history=history,
                delivered_song_keys=set(radio["_delivered_song_keys"](session)),
                candidate_scores=ranked, rng=random.Random(0),
            )
            original = min(ranked, key=lambda item: item[1]) if ranked else None
            winner_key = canonical(original[0]) if original else None
            delivered = radio["_delivered_song_keys"](session)
            reason = "ranking"
            if winner_key in delivered:
                reason = "delivery" if selected and selected["id"] != original[0]["id"] else "delivery-fallback"
            elif winner_key in history:
                reason = "history" if selected and selected["id"] != original[0]["id"] else "quality-fallback"
            limit = original[1] + radio["_RADIO_RECENCY_QUALITY_BAND"] if winner_key in history else None
            score_by_id = {r["id"]: round(score, 6) for r, score, _d in ranked}
            rendered = []
            buffer_keys = {canonical(r) for r in buffer}
            for r in rows:
                key = canonical(r)
                if r["id"] in {b["id"] for b in buffer}:
                    status = "In buffer"
                elif key in buffer_keys:
                    status = "Buffered song family"
                elif key in history:
                    status = "Heard recently"
                elif key in delivered:
                    status = "Delivered this session"
                elif limit is not None and score_by_id.get(r["id"], float("inf")) > limit:
                    status = "Outside quality band"
                else:
                    status = "Fresh"
                rendered.append({"id": r["id"], "artist": r["artist"], "title": r["title"],
                                 "key": list(key), "score": score_by_id.get(r["id"]), "status": status})
            # Presentation order follows the actual Python ranking. Hard buffer
            # exclusions have no score and stay together after eligible rows.
            rendered.sort(key=lambda r: (r["score"] is None, r["score"] or 0, r["id"]))
            return selected, {"originalWinnerId": original[0]["id"] if original else None,
                              "qualityLimit": round(limit, 6) if limit is not None else None,
                              "reason": reason, "candidates": rendered}

        def event(kind, title, description, choose=False):
            selected, details = inspect()
            events.append({"kind": kind, "title": title, "description": description,
                           "bufferIds": [r["id"] for r in buffer],
                           "deliveredKeys": deepcopy(session.get("delivered_song_keys", [])),
                           "historyKeys": [list(key) for key in history], "play": deepcopy(play),
                           "selectedId": selected["id"] if choose and selected else None,
                           **details})
            return selected

        def deliver(selected, description):
            buffer[:] = [selected]
            radio["_record_delivered_songs"](session, [selected])
            event("deliver", "Delivered to the queue", description)

        def listen(seconds):
            nonlocal play
            significant = policy["is_significant_play"](seconds, 180)
            play = {"seconds": seconds, "duration": 180,
                    "threshold": policy["significant_play_threshold"](180), "significant": significant}
            if significant:
                history[canonical(buffer[0])] = {"frequency": 1}
            event("play", "30 seconds played" if significant else "Skipped after 5 seconds",
                  "The play qualifies for the seven-day history, including this song's live version."
                  if significant else "Five seconds is below this track's 30-second threshold. Delivery is remembered; significant history stays empty.")

        if case_id == "listen":
            buffer[:] = [rows[0]]
            radio["_record_delivered_songs"](session, buffer)
            event("buffer", "Already in the buffer", "The queued recording and its live version are hard exclusions while this song remains in the buffer.")
            listen(30)
            buffer.clear()
            session.clear()
            event("new-session", "A new session", "The session ledger is empty. The qualifying listen remains in the seven-day history under one canonical song identity.")
            event("rank", "Rank the candidates", "The best score is 0.10. A fresh candidate at 0.14 fits within the 0.15 limit; the live version shares the recent song identity.")
            selected = event("choose", "Rotate within 0.05", "Choose Fresh at 0.14 instead of the recently heard song at 0.10.", True)
            deliver(selected, "Only Fresh enters this session's delivery ledger. Generating it does not add another significant listen.")
        elif case_id == "quality":
            history[canonical(rows[0])] = {"frequency": 1}
            event("history", "A qualifying listen exists", "The active buffer and session ledger are empty. Delivered X has a qualifying play within the last seven days.")
            event("rank", "Keep the quality limit", "The best score is 0.10, so an unheard replacement must score at most 0.15. The fresh candidates score 0.40 and 1.00.")
            selected = event("choose", "Keep the recent candidate", "No fresh candidate fits the quality band. The recent song stays available instead of forcing a weaker replacement.", True)
            deliver(selected, "The repeated song is delivered again. The original qualifying listen remains unchanged.")
        else:
            event("rank", "Rank the first refill", "The synthetic pool scores 0.10, 0.40 and 1.00. Lower scores are better; the three memories are empty.")
            selected = event("choose", "Choose the best score", "Delivered X wins the first refill at 0.10.", True)
            deliver(selected, "The song is in the active buffer and the session delivery ledger. Delivery alone is not a listen.")
            listen(5)
            buffer.clear()
            if case_id == "limited":
                rows[:] = rows[:1]
            event("rank", "Refill an empty buffer",
                  "Only the delivered song remains in this fixture's eligible pool. Its normalized score is now 1.00."
                  if case_id == "limited" else "The buffer is empty but the session remembers Delivered X. Fresh is outside a 0.05 band; delivery uses a separate check.")
            selected = event("choose", "Recover the delivered song" if case_id == "limited" else "Choose an undelivered song",
                             "There is no truly fresh candidate in this pool. Delivery cooldown allows the song to return."
                             if case_id == "limited" else "The delivery check chooses Fresh at 0.40. It does not apply the listening-history quality band.", True)
            deliver(selected, "The latest returned song updates delivery order. Neither this refill nor the earlier skip creates a significant listen.")
        return {"id": case_id, "label": label, "catalog": catalog, "events": events}

    return {"version": 1, "source": {"commit": PIN, "selectorFile": ENGINE,
            "selectorLines": _location(sources[ENGINE], "_select_radio_candidate_from_rows"),
            "regressionFile": TEST, "regressionLines": _location(sources[TEST], "test_delivered_song_cannot_beat_a_fresh_song_by_escaping_the_history_quality_band"),
            "sha256": {p: hashlib.sha256(sources[p].encode()).hexdigest() for p in FILES},
            "adapters": "Synthetic catalogue, fixed distances, acoustic-only weights, empty graphs and no artist counts; no batch generator, SQL, Redis, production audio or timing measurements."},
            "cases": [run("skip", "Short skip"), run("listen", "Significant listen"),
                      run("quality", "Quality limit"), run("limited", "Small catalogue")]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)
    serialized = json.dumps(build_fixture(), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text() != serialized:
            print("Radio fixture differs from pinned Python execution.", file=sys.stderr)
            return 1
        print("Radio fixture matches pinned Python execution.")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized)
        print(f"Exported {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
