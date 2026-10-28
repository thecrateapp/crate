# Seeded radio recommendation baselines

Checkpoint 2.0 for seven-day radio rotation. These fixtures capture the current first-batch candidate pool; the scoring and retrieval code remain unchanged.

## Reproduce

From `app/`:

```bash
../.venv/bin/python -m tests.recommendation_evaluation
../.venv/bin/python -m pytest tests/test_recommendation_evaluation.py -q
```

The JSON report contains all twenty tracks for three independent synthetic sessions on 2026-10-28, 2026-10-29 and 2026-10-30. Repeating the command produces the same report across host time zones and Python hash seeds.

## Provenance and limits

- Catalog captured on 2026-10-28 in a repeatable-read, read-only PostgreSQL transaction, using the deployed candidate queries.
- Deployed API image revision: `82ea84746f62f0c6052fdd5fdcf84dbb092c130b`. Replay engine: PR #299 at `9f9e64d2010131cfc7246ea5d0e122670492eb77`.
- Source hashes of batch generation, candidate selection, seeded weights and seeded retrieval matched between production and the replay engine. Each fixture records those hashes.
- Each snapshot retains 120 retrieved candidates and the catalog signals used to rank them. Graph roots are limited to seed/candidate artists; their outgoing edges remain available for second-degree affinity.
- Track and album IDs are remapped. Entity/global IDs, paths, credentials and user events are omitted. The listener is synthetic (`user_id=0`) with no likes, dislikes or listening history.
- Generation runs in memory, with database/Redis/persistence boundaries blocked. Generated tracks do not count as listened tracks.
- This freezes the first-batch ranking input. It does not benchmark production latency, test retrieval expansion, or demonstrate that seven-day history rotation already works. Those belong to the following tasks.

## Current measurements

Sessions A/B/C correspond to the three days above. Song identity uses the shared canonical artist/title identity; position overlap measures the same song at the same index.

| Seed | A vs B: shared / same position | A vs C | B vs C | Unique artists per batch |
| --- | --- | --- | --- | --- |
| Citizen | 20/20 · 20/20 | 20/20 · 20/20 | 20/20 · 20/20 | 11/11/11 |
| Concubine — Converge | 17/20 · 8/20 | 17/20 · 8/20 | 19/20 · 19/20 | 20/20/20 |

Artist-genre metadata coverage is 100% for these returned tracks and seeds. Mean weighted genre overlap against the seed (A/B/C):

| Seed | A | B | C |
| --- | ---: | ---: | ---: |
| Citizen | 0.399595 | 0.399595 | 0.399595 |
| Concubine — Converge | 0.460150 | 0.453764 | 0.462912 |

Genre overlap is a metadata proxy using weighted artist genres and the existing static ancestor taxonomy. It is not a percentage of musical correctness. Missing metadata is reported separately rather than treated as proven musical drift.

Citizen repeats every song in the same order despite different generation seeds and dates. Concubine already varies some songs and positions while retaining its artist context. These observations set a comparison point; the tests deliberately do not require these exact lists forever.

## First batch for review (session A)

| # | Citizen radio | Concubine radio |
| ---: | --- | --- |
| 1 | Movements — Third Degree | Botch — Mondrian Was a Liar |
| 2 | Turnover — Humming | Coalesce — A New Language |
| 3 | Basement — Whole | The Dillinger Escape Plan — Panasonic Youth |
| 4 | Movements — Full Circle | Better Lovers — Become So Small |
| 5 | Turnover — Cutting My Fingers Off | The Chariot — They Drew Their Swords |
| 6 | Title Fight — 27 | Norma Jean — Blueprints for Future Homes |
| 7 | Basement — Pine | Cave In — Jupiter |
| 8 | Balance and Composure — I Tore You Apart In My Head | Poison The Well — A Wish for Wings That Work |
| 9 | Title Fight — Shed | Zao — Lies Of Serpents, A River Of Tears |
| 10 | Fiddlehead — Get My Mind Right | Trap Them — Fucking Viva |
| 11 | One Step Closer — Giant's Despair | As I Lay Dying — Nothing Left |
| 12 | Balance and Composure — Notice Me | Code Orange — Forever |
| 13 | Drug Church — Weed Pin | Nails — Wide Open Wound |
| 14 | Fiddlehead — Million Times | The Armed — ALL FUTURES |
| 15 | One Step Closer — Orange Leaf | Birds In Row — Pilori |
| 16 | Self Defense Family — The Supremacy of Pure Artistic Feeling | Pig Destroyer — Army of Cops |
| 17 | Tigers Jaw — The Sun | Loma Prieta — Fly By Night |
| 18 | Joyce Manor — Beach Community | Ampere — Of Nightmare Reality |
| 19 | Joyce Manor — Falling in Love Again | Car Bomb — Lights Out |
| 20 | Tigers Jaw — Plane Vs. Tank Vs. Submarine | Gridiron — No Good At Goodbyes |

The first nine Concubine picks match the previously reviewed example. The reference session and this neutral synthetic session are not identical inputs; exact ordering is evidence rather than a permanent acceptance rule.

## Review checkpoint

Review these references before changing ranking. The next tasks add significant-listen history, bounded candidate expansion and seven-day rotation, followed by the same comparison. No ranking weights, drift settings, ingestion behavior or application UI changed in this checkpoint.
