# Recommendation fixtures

`citizen.json` and `concubine.json` freeze the first-batch candidate pools and musical signals used by `tests.recommendation_evaluation`.

## Format

Each fixture contains a schema version, a reference day, a batch size, the initial synthetic session, 120 candidate records, artist relationship/genre graphs and provenance hashes. Candidate records, vectors and graph entries use compact JSON serialization; changing whitespace does not change any numerical input.

Track and album IDs are remapped. Entity/global IDs, paths, credentials and real user events are omitted. The listener is synthetic and starts without likes, dislikes or listening history. Generated tracks do not count as listened tracks.

`citizen.mix_edges.json` and `concubine.mix_edges.json` add the Smart Mix edge signals of the same candidates, keyed by the remapped track IDs. They were captured read-only from current production profiles; candidates whose profile is missing or stale are absent, as they are for the live ranking.

## Reproduce

From `app/`:

```bash
CRATE_RADIO_ROTATION_ENABLED=false ../.venv/bin/python -m tests.recommendation_evaluation
CRATE_RADIO_ROTATION_ENABLED=true ../.venv/bin/python -m tests.recommendation_evaluation --simulate-listens
../.venv/bin/python -m pytest tests/test_recommendation_evaluation.py -q
```

`--mix-edges` loads the edge sidecars and adds seam metrics to each session. Compare `CRATE_TRANSITION_FIT_ENABLED=false` with `true` to measure the transition fit.

The report contains three independent synthetic sessions on fixed dates. Repeating the commands produces the same report across host time zones and Python hash seeds. `--simulate-listens` adds completed listens after each batch within the captured pool.

Replay runs in memory with database, Redis and persistence boundaries blocked. It does not exercise full-catalog retrieval expansion or measure endpoint latency. PostgreSQL regressions cover retrieval separately.

Historical listening comparisons, approvals and measurements live in [baselines](../../../../docs/technical/evidence/radio/baselines.md) and the [rotation comparison](../../../../docs/technical/evidence/radio/rotation-review.md).
