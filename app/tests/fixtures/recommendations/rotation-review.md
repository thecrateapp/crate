# Radio rotation — checkpoint 2.3

Checkpoint 2.0 was approved by Diego on 2026-10-28. This comparison uses the same Citizen artist seed and Concubine track seed on the production catalog, in an isolated read-only process. No application sessions, feedback or play events were written.

## Method

- A/B/C are independent sessions on 2026-10-28/29/30 with the same synthetic listener and neutral preferences.
- A uses the legacy algorithm. B uses rotation after synthetic completed listens for every song in A. C uses rotation after completed listens for both previous sessions. Merely generating songs does not create history in the application.
- The catalog and musical graphs are live read-only inputs. Unlike the 120-row offline snapshots, this evaluation exercises bounded SQL candidate expansion.
- All three sessions return 20 songs. Song-set and position overlap use the same shared queue identity as checkpoint 2.0.
- The policy prefers fresh songs within 0.05 of the best musical score; recently heard songs remain available when no equivalent fresh candidate remains. It does not promise zero repeated songs at any musical cost.

## Comparison

| Seed      | Pair | Before: shared / same position | After: shared / same position |
| --------- | ---- | ------------------------------ | ----------------------------- |
| Citizen   | A/B  | 20/20 · 20/20                  | 1/20 · 0/20                   |
| Citizen   | A/C  | 20/20 · 20/20                  | 0/20 · 0/20                   |
| Citizen   | B/C  | 20/20 · 20/20                  | 4/20 · 0/20                   |
| Concubine | A/B  | 17/20 · 8/20                   | 1/20 · 0/20                   |
| Concubine | A/C  | 17/20 · 8/20                   | 0/20 · 0/20                   |
| Concubine | B/C  | 19/20 · 19/20                  | 5/20 · 0/20                   |

The same starting order no longer dominates successive sessions. Some songs still return within seven days under the quality fallback; this is intentional and is visible in the B/C figures.

## Musical context

| Seed      | Session | Artist-genre overlap | Genre coverage | Unique artists |
| --------- | ------- | -------------------: | -------------: | -------------: |
| Citizen   | A       |             0.399595 |          20/20 |             11 |
| Citizen   | B       |             0.430313 |          20/20 |             10 |
| Citizen   | C       |             0.410997 |          20/20 |             13 |
| Concubine | A       |             0.460150 |          20/20 |             20 |
| Concubine | B       |             0.523175 |          20/20 |             20 |
| Concubine | C       |             0.501754 |          20/20 |             20 |

Genre overlap is a weighted artist-metadata proxy with the existing ancestor taxonomy, not a percentage of musical correctness. Musical weights, drift and the seed anchor are unchanged. Listening review is still required.

## Lists for listening review

A is the approved reference listed in [README.md](README.md). B and C are the new sessions:

### Citizen — artist radio

|   # | B: after listening to A                | C: after listening to A and B            |
| --: | -------------------------------------- | ---------------------------------------- |
|   1 | Turnover — I Would Hate You If I Could | Turnover — Take My Head                  |
|   2 | Movements — Deadly Dull                | Movements — Suffer Through               |
|   3 | Turnover — Like Slow Disappearing      | Basement — Crickets Throw Their Voice    |
|   4 | Balance and Composure — Void           | Title Fight — Crescent-Shaped Depression |
|   5 | Movements — Deep Red                   | Turnover — Hello Euphoria                |
|   6 | Basement — Bad Apple                   | Basement — Covet                         |
|   7 | Title Fight — Mrahc                    | Fiddlehead — Sullenboy                   |
|   8 | Balance and Composure — Stonehands     | Movements — Deep Red                     |
|   9 | Fiddlehead — Loverman                  | Title Fight — Mrahc                      |
|  10 | One Step Closer — Chrysanthemum        | Tigers Jaw — Chemicals                   |
|  11 | Basement — Spoiled                     | Joyce Manor — Heart Tattoo               |
|  12 | Title Fight — Lefty                    | Glitterer — Plastic                      |
|  13 | Fiddlehead — Million Times             | Tigers Jaw — Meals on Wheels             |
|  14 | One Step Closer — Leave Me Behind      | Joyce Manor — End of the Summer          |
|  15 | Tigers Jaw — June                      | Balance and Composure — Stonehands       |
|  16 | Joyce Manor — Christmas Card           | The Hotelier — Your Deep Rest            |
|  17 | Boston Manor — Crocus                  | Have Mercy — The Place You Love          |
|  18 | Tigers Jaw — Meals on Wheels           | Balance and Composure — Quake            |
|  19 | Joyce Manor — Leather Jacket           | Tiny Moving Parts — Always Focused       |
|  20 | Boston Manor — Passenger               | Boston Manor — England's Dreaming        |

### Concubine — Converge, track radio

|   # | B: after listening to A                     | C: after listening to A and B                       |
| --: | ------------------------------------------- | --------------------------------------------------- |
|   1 | Botch — Transitions from Persona to Object  | Botch — To Our Friends in the Great White North     |
|   2 | Coalesce — On Being a Bastard               | The Dillinger Escape Plan — 43% Burnt               |
|   3 | The Dillinger Escape Plan — 43% Burnt       | Coalesce — You Can't Kill Us All                    |
|   4 | Better Lovers — 30 Under 13                 | Better Lovers — Sacrificial Participant             |
|   5 | The Chariot — Daggers                       | The Armed — A LIFE SO WONDERFUL                     |
|   6 | Norma Jean — Songs Sound Much Sadder        | The Chariot — Teach:                                |
|   7 | Poison The Well — Not Within Arms Length    | Norma Jean — Sword In Mouth, Fire Eyes              |
|   8 | Cave In — Jupiter                           | Poison The Well — 12/23/93                          |
|   9 | Mutoid Man — Bridgeburner                   | Cave In — Anchor                                    |
|  10 | Converge — Dark Horse                       | Code Orange — My World                              |
|  11 | The Armed — MASUNAGA VAPORS                 | Mutoid Man — Bridgeburner                           |
|  12 | Killer Be Killed — Wings of Feather and Wax | Birds In Row — There Is Only One Chair In This Room |
|  13 | Birds In Row — Water Wings                  | Nails — God's Cold Hands                            |
|  14 | Coilguns — Generic Skincare                 | Trap Them — Hellionaires                            |
|  15 | Code Orange — Swallowing the Rabbit Whole   | Terror — Keepers of the Faith                       |
|  16 | Crossed — Flores Rotas                      | No Cure — Hang Me From the Bible Belt               |
|  17 | Nails — God's Cold Hands                    | Incendiary — Front Toward Enemy                     |
|  18 | Terror — Keepers of the Faith               | Inclination — Thoughts and Prayers                  |
|  19 | Incendiary — Front Toward Enemy             | Knocked Loose — Suffocate (feat. Poppy)             |
|  20 | Hatebreed — I Will Be Heard                 | Life's Question — The Will To Dream                 |

## Performance evidence

Measured on 2026-10-28 in the production host against the production catalog, inside a standalone process with a repeatable-read, read-only transaction. Warm musical graph cache; 25 measured samples per seed after one warm-up. Each sample resolves an actual three-track buffer, reads the seven-day history and generates 20 tracks. Real history was used only for timings; its contents are neither printed nor stored here.

| Seed      |        p50 |        p95 |    Maximum | Data SELECTs including buffer |
| --------- | ---------: | ---------: | ---------: | ----------------------------: |
| Citizen   | 194.918 ms | 210.055 ms | 264.999 ms |                             3 |
| Concubine | 154.941 ms | 195.742 ms | 197.118 ms |                             3 |

These are **buffer lookup + generation** timings, not end-to-end HTTP/Redis latency. Both generation p95 values fit the 250 ms target; HTTP endpoint p95 remains to be measured before release. Global metadata-only fallback and the optional second expansion are covered by bounded-query regressions, not these two timing cases.

A separate representative history benchmark (48,004 tracks, 100,001 events, 1,251 significant events in the window, 300 candidate references, 25 samples) measured 14.099 ms p95 in one query. No new index was justified by EXPLAIN.

## Review gate

Implementation and scoped checks are complete. Diego approved the B/C lists and publication of PR2 on 2026-10-28. PR2 remains stacked on PR #299; merge, deployment and Music Paths changes are outside this checkpoint.
