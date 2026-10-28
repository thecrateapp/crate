# Music Paths: revised genre bridge, 20-step checkpoint

Status: provisional listening review. The route source is frozen separately; every other recommendation module comes from commit 808ef151. Checkpoint 3.4 metadata is not included in these measurements.

The evaluation ran in an isolated read-only process with an empty synthetic history, the fixed seed `musical-rotation-controlled` and AI disabled. Redis accepted only reads (`GET`/`PING`); no write was attempted. These are single probes, not p95 measurements.

| Case                | Base route                               | Returned |   Time | Duplicate tracks/families |
| ------------------- | ---------------------------------------- | -------: | -----: | ------------------------: |
| punk-to-electronic  | punk → punk-rock → new-wave → electronic |    20/20 | 2.979s |                       0/0 |
| electronic-to-punk  | electronic → new-wave → punk-rock → punk |    20/20 | 2.605s |                       0/0 |
| citizen-to-converge | pop-punk → punk → hardcore-punk          |    20/20 | 1.844s |                       0/0 |

Citizen keeps exactly the same artist/title ordering as the earlier neutral reference. Both genre routes preserve their endpoints and avoid Japanoise. The genre single probes still exceed the 2s budget; no 25-sample benchmark is claimed.

The former Undertones→Merzbow shortcut is absent. Listening review should still inspect the new stage boundary Propagandhi — “Fuck the Border”→New Order — “Blue Monday '88” (positions 10→11).

## punk-to-electronic

|   # | Artist               | Song                         | Stage      |
| --: | -------------------- | ---------------------------- | ---------- |
|   1 | The Clash            | Rock the Casbah (Remastered) | punk       |
|   2 | The Jam              | Town Called Malice           | punk       |
|   3 | Stiff Little Fingers | Here We Are Nowhere          | punk       |
|   4 | The Undertones       | Here Comes the Summer        | punk       |
|   5 | Social Distortion    | Ring of Fire                 | punk-rock  |
|   6 | Rancid               | Fall Back Down               | punk-rock  |
|   7 | The Menzingers       | The Obituaries               | punk-rock  |
|   8 | Hot Water Music      | Trusty Chords                | punk-rock  |
|   9 | Off With Their Heads | Nightlife                    | punk-rock  |
|  10 | Propagandhi          | Fuck the Border              | punk-rock  |
|  11 | New Order            | Blue Monday '88              | new-wave   |
|  12 | Joy Division         | Love Will Tear Us Apart      | new-wave   |
|  13 | The Cure             | Friday I'm In Love           | new-wave   |
|  14 | Depeche Mode         | World In My Eyes             | new-wave   |
|  15 | Gary Numan           | Cars                         | new-wave   |
|  16 | Killing Joke         | Love Like Blood              | new-wave   |
|  17 | M83                  | Midnight City                | electronic |
|  18 | Caribou              | Home                         | electronic |
|  19 | Four Tet             | Unspoken                     | electronic |
|  20 | Aphex Twin           | Xtal                         | electronic |

## electronic-to-punk

|   # | Artist            | Song                                 | Stage      |
| --: | ----------------- | ------------------------------------ | ---------- |
|   1 | M83               | Wait                                 | electronic |
|   2 | Caribou           | Bees                                 | electronic |
|   3 | Four Tet          | She Just Likes to Fight              | electronic |
|   4 | Aphex Twin        | Pulsewidth                           | electronic |
|   5 | Gary Numan        | M.E.                                 | new-wave   |
|   6 | Killing Joke      | Eighties                             | new-wave   |
|   7 | New Order         | Blue Monday (2016 Remaster)          | new-wave   |
|   8 | Joy Division      | Atmosphere                           | new-wave   |
|   9 | The Cure          | Just Like Heaven                     | new-wave   |
|  10 | Depeche Mode      | Personal Jesus                       | new-wave   |
|  11 | Social Distortion | Don't Drag Me Down                   | punk-rock  |
|  12 | Rancid            | Fall Back Down                       | punk-rock  |
|  13 | The Clash         | London Calling                       | punk-rock  |
|  14 | The Undertones    | Teenage Kicks                        | punk-rock  |
|  15 | Hot Water Music   | Trusty Chords                        | punk-rock  |
|  16 | The Menzingers    | Good Things                          | punk-rock  |
|  17 | Propagandhi       | Dear Coach's Corner                  | punk       |
|  18 | Descendents       | Good Good Things                     | punk       |
|  19 | Hüsker Dü         | Don't Want to Know If You Are Lonely | punk       |
|  20 | Jawbreaker        | Jet Black                            | punk       |

## citizen-to-converge

|   # | Artist               | Song                                 | Stage         |
| --: | -------------------- | ------------------------------------ | ------------- |
|   1 | CITIZEN              | The Night I Drove Alone              | pop-punk      |
|   2 | Turnover             | Dizzy On the Comedown                | pop-punk      |
|   3 | Title Fight          | Where Am I?                          | pop-punk      |
|   4 | Joyce Manor          | Leather Jacket                       | pop-punk      |
|   5 | Tigers Jaw           | Between Your Band and the Other Band | pop-punk      |
|   6 | Descendents          | Good Good Things                     | punk          |
|   7 | Hüsker Dü            | Something I Learned Today            | punk          |
|   8 | Propagandhi          | Less Talk, More Rock                 | punk          |
|   9 | Rancid               | Radio                                | punk          |
|  10 | Dropkick Murphys     | I'm Shipping Up To Boston            | punk          |
|  11 | Jawbreaker           | Jet Black                            | punk          |
|  12 | The Clash            | Rudie Can't Fail                     | punk          |
|  13 | The Jam              | Going Underground                    | punk          |
|  14 | Stiff Little Fingers | Wasted Life                          | punk          |
|  15 | The Undertones       | My Perfect Cousin                    | punk          |
|  16 | Black Flag           | Rise Above                           | hardcore-punk |
|  17 | Minor Threat         | I Don't Wanna Hear It                | hardcore-punk |
|  18 | Dag Nasty            | I’ve Heard                           | hardcore-punk |
|  19 | Circle Jerks         | Red Tape                             | hardcore-punk |
|  20 | Converge             | Phoenix in Flight                    | hardcore-punk |

## Long-path follow-up

A second guard applies the same specificity criterion to optional destination
expansions, before the three-extra limit. The corrected 100-track reverse
journey returns 100/100 tracks with both endpoints, no repeated song families
and no Japanoise stage. Its single probe took 4.710 s; this is not a p95.

Interpolating route guides also respects the requested count when the route
has more stages than available slots. Explicit niche endpoints remain valid;
no artists or genres are blacklisted and the global taxonomy/radio weights
are unchanged.

Sanitized sources and measurements: [music-paths-bridge-evaluation.json](music-paths-bridge-evaluation.json).
Musical listening approval and the genre-20 latency target remain open.
