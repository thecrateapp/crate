# Music Paths: checkpoints 3.1–3.3 catalog review

> Historical capture: this report describes its recorded source snapshot before the reviewed fixes. Its measurements, warnings and approval notes do not validate the current implementation. See the [evidence index](README.md) and [current behavior](../../music-paths.md).

Historical comparison: Diego rejected the punk-to-Japanoise bridge. See the
[revised bridge checkpoint](music-paths-bridge-review.md) for its replacement.

**Recorded review status:** musical approval was pending at this capture, which covered endpoint context, anchor/coherence work and seven-day rotation. Later captures and the current behavior are linked from the evidence index.

Production was accessed through an isolated read-only process. The planner used local sources, a neutral listener, disabled AI and synthetic completed listens. No listening session, play event or Music Path was persisted. These are recommendation lists for review, not evidence of musical correctness.

A/B/C/D use the same selection seed. Recent songs and previous generations are soft preferences within comparable quality tiers; they do not promise zero repetitions. Canonical song families, not edition-specific track identities, determine repeats.

## Performance

| Case                | Requested / returned | Samples |    p50 |        p95 | Maximum | Result                    |
| ------------------- | -------------------- | ------: | -----: | ---------: | ------: | ------------------------- |
| citizen-to-converge | 20 / 20              |      25 | 1.535s |     1.667s |  1.703s | p95 within budget         |
| citizen-to-converge | 100 / 100            |      25 | 4.412s |     4.800s |  6.275s | p95 within budget         |
| punk-to-electronic  | 20 / 20              | 1 probe |      — | unmeasured |  2.078s | first probe above 2s gate |
| punk-to-electronic  | 100 / 97             |      25 | 4.022s |     4.367s |  4.382s | p95 within budget         |

Times cover in-process planning and exclude HTTP transport. Taxonomy was warmed with normal revision checks enabled. Artist query counts varied by three reads during the long run, consistent with taxonomy refreshes. No p95 is claimed for 20-step genre case. The single profiled 20-step genre case run was dominated by candidate SQL and graph construction. End-to-end acoustic performance remains unaccepted until the missing cosine index is deployed; the local vector fixture is not a substitute for endpoint latency.

The 100-step genre path returns 97 distinct songs. Explicit partial-result metadata/warnings belong to checkpoint 3.4. The synthetic scarce-catalog fixture returns its six distinct songs for requests of 20/100, preserving both ends even when every song is recent.

## Controlled rotation

| Variant | Meaning                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| A       | Neutral reference; no listening history and no previous generation.                             |
| B       | All of A was completed synthetically within the seven-day window.                               |
| C       | Regenerate B; the only completed listening remains A. B is supplied as the previous generation. |
| D       | All of A and B were completed synthetically. B is also the previous generation.                 |

“Fresh” below means outside the synthetic history for that variant. A previous-generation marker is independent of listening history. No real user history is used.

## CITIZEN → Converge

| Variant | Fresh vs history | Repeated from history | New vs previous B | Repeated from B | Mean adjacent BPM delta | Mean adjacent cosine distance |
| ------- | ---------------: | --------------------: | ----------------: | --------------: | ----------------------: | ----------------------------: |
| A       |            20/20 |                     0 |                 — |               — |                   24.31 |                       0.02192 |
| B       |            19/20 |                     1 |                 — |               — |                   31.94 |                       0.02294 |
| C       |            15/20 |                     5 |             19/20 |               1 |                   40.31 |                       0.02474 |
| D       |            14/20 |                     6 |             19/20 |               1 |                   40.31 |                       0.02474 |

All four lists contain 20 songs, preserve both endpoints and have 0 duplicate tracks/canonical families. With this seed, C and D happen to have identical ordering; their listening-history sets and freshness counts differ. BPM and cosine coverage are 100% in these lists. These measures are transition proxies, not approval of musical coherence.

### A — Neutral reference

|   # | Artist               | Song                                 | Stage         | Synthetic review marker |
| --: | -------------------- | ------------------------------------ | ------------- | ----------------------- |
|   1 | CITIZEN              | The Night I Drove Alone              | pop-punk      | fresh                   |
|   2 | Turnover             | Dizzy On the Comedown                | pop-punk      | fresh                   |
|   3 | Title Fight          | Where Am I?                          | pop-punk      | fresh                   |
|   4 | Joyce Manor          | Leather Jacket                       | pop-punk      | fresh                   |
|   5 | Tigers Jaw           | Between Your Band and the Other Band | pop-punk      | fresh                   |
|   6 | Descendents          | Good Good Things                     | punk          | fresh                   |
|   7 | Hüsker Dü            | Something I Learned Today            | punk          | fresh                   |
|   8 | Propagandhi          | Less Talk, More Rock                 | punk          | fresh                   |
|   9 | Rancid               | Radio                                | punk          | fresh                   |
|  10 | Dropkick Murphys     | I'm Shipping Up To Boston            | punk          | fresh                   |
|  11 | Jawbreaker           | Jet Black                            | punk          | fresh                   |
|  12 | The Clash            | Rudie Can't Fail                     | punk          | fresh                   |
|  13 | The Jam              | Going Underground                    | punk          | fresh                   |
|  14 | Stiff Little Fingers | Wasted Life                          | punk          | fresh                   |
|  15 | The Undertones       | My Perfect Cousin                    | punk          | fresh                   |
|  16 | Black Flag           | Rise Above                           | hardcore-punk | fresh                   |
|  17 | Minor Threat         | I Don't Wanna Hear It                | hardcore-punk | fresh                   |
|  18 | Dag Nasty            | I’ve Heard                           | hardcore-punk | fresh                   |
|  19 | Circle Jerks         | Red Tape                             | hardcore-punk | fresh                   |
|  20 | Converge             | Phoenix in Flight                    | hardcore-punk | fresh                   |

### B — After listening to all of A

|   # | Artist               | Song                                 | Stage         | Synthetic review marker    |
| --: | -------------------- | ------------------------------------ | ------------- | -------------------------- |
|   1 | CITIZEN              | How Does It Feel?                    | pop-punk      | fresh                      |
|   2 | Turnover             | Like Slow Disappearing               | pop-punk      | fresh                      |
|   3 | Title Fight          | Lefty                                | pop-punk      | fresh                      |
|   4 | Modern Baseball      | Fine, Great                          | pop-punk      | fresh                      |
|   5 | Joyce Manor          | Falling in Love Again                | pop-punk      | fresh                      |
|   6 | Descendents          | Hope                                 | punk          | fresh                      |
|   7 | Hüsker Dü            | Don't Want to Know If You Are Lonely | punk          | fresh                      |
|   8 | Propagandhi          | Ska Sucks                            | punk          | fresh                      |
|   9 | Dropkick Murphys     | The State Of Massachusetts           | punk          | fresh                      |
|  10 | Rancid               | Out of Control                       | punk          | fresh                      |
|  11 | Jawbreaker           | Boxcar                               | punk          | fresh                      |
|  12 | The Clash            | London Calling                       | punk          | fresh                      |
|  13 | Stiff Little Fingers | Suspect Device                       | punk          | fresh                      |
|  14 | The Jam              | Town Called Malice                   | punk          | fresh                      |
|  15 | N8NOFACE             | Say Goodbye                          | punk          | fresh                      |
|  16 | Dag Nasty            | Circles                              | hardcore-punk | fresh                      |
|  17 | Minor Threat         | I Don't Wanna Hear It                | hardcore-punk | heard in synthetic history |
|  18 | Black Flag           | Six Pack                             | hardcore-punk | fresh                      |
|  19 | Bad Brains           | Banned in D.C.                       | hardcore-punk | fresh                      |
|  20 | Converge             | Hell to Pay                          | hardcore-punk | fresh                      |

### C — Regenerate B without any new listening

|   # | Artist               | Song                        | Stage         | Synthetic review marker    |
| --: | -------------------- | --------------------------- | ------------- | -------------------------- |
|   1 | CITIZEN              | Sleep                       | pop-punk      | fresh                      |
|   2 | Turnover             | I Would Hate You If I Could | pop-punk      | fresh                      |
|   3 | Joyce Manor          | Heart Tattoo                | pop-punk      | fresh                      |
|   4 | Tigers Jaw           | The Sun                     | pop-punk      | fresh                      |
|   5 | Title Fight          | Numb, But I Still Feel It   | pop-punk      | fresh                      |
|   6 | Hüsker Dü            | Pink Turns to Blue          | punk          | fresh                      |
|   7 | Descendents          | 'Merican                    | punk          | fresh                      |
|   8 | Rancid               | Time Bomb                   | punk          | fresh                      |
|   9 | Propagandhi          | Less Talk, More Rock        | punk          | heard in synthetic history |
|  10 | Dropkick Murphys     | Rose Tattoo                 | punk          | fresh                      |
|  11 | Jawbreaker           | Jet Black                   | punk          | heard in synthetic history |
|  12 | The Clash            | Lost in the Supermarket     | punk          | fresh                      |
|  13 | The Jam              | The Eton Rifles             | punk          | fresh                      |
|  14 | Stiff Little Fingers | Wasted Life                 | punk          | heard in synthetic history |
|  15 | The Undertones       | My Perfect Cousin           | punk          | heard in synthetic history |
|  16 | Black Flag           | Spray Paint                 | hardcore-punk | fresh                      |
|  17 | Minor Threat         | Minor Threat                | hardcore-punk | fresh                      |
|  18 | Dag Nasty            | I’ve Heard                  | hardcore-punk | heard in synthetic history |
|  19 | Bad Brains           | Attitude                    | hardcore-punk | fresh                      |
|  20 | Converge             | Hell to Pay                 | hardcore-punk | in previous generation B   |

### D — After listening to all of A and B

|   # | Artist               | Song                        | Stage         | Synthetic review marker                              |
| --: | -------------------- | --------------------------- | ------------- | ---------------------------------------------------- |
|   1 | CITIZEN              | Sleep                       | pop-punk      | fresh                                                |
|   2 | Turnover             | I Would Hate You If I Could | pop-punk      | fresh                                                |
|   3 | Joyce Manor          | Heart Tattoo                | pop-punk      | fresh                                                |
|   4 | Tigers Jaw           | The Sun                     | pop-punk      | fresh                                                |
|   5 | Title Fight          | Numb, But I Still Feel It   | pop-punk      | fresh                                                |
|   6 | Hüsker Dü            | Pink Turns to Blue          | punk          | fresh                                                |
|   7 | Descendents          | 'Merican                    | punk          | fresh                                                |
|   8 | Rancid               | Time Bomb                   | punk          | fresh                                                |
|   9 | Propagandhi          | Less Talk, More Rock        | punk          | heard in synthetic history                           |
|  10 | Dropkick Murphys     | Rose Tattoo                 | punk          | fresh                                                |
|  11 | Jawbreaker           | Jet Black                   | punk          | heard in synthetic history                           |
|  12 | The Clash            | Lost in the Supermarket     | punk          | fresh                                                |
|  13 | The Jam              | The Eton Rifles             | punk          | fresh                                                |
|  14 | Stiff Little Fingers | Wasted Life                 | punk          | heard in synthetic history                           |
|  15 | The Undertones       | My Perfect Cousin           | punk          | heard in synthetic history                           |
|  16 | Black Flag           | Spray Paint                 | hardcore-punk | fresh                                                |
|  17 | Minor Threat         | Minor Threat                | hardcore-punk | fresh                                                |
|  18 | Dag Nasty            | I’ve Heard                  | hardcore-punk | heard in synthetic history                           |
|  19 | Bad Brains           | Attitude                    | hardcore-punk | fresh                                                |
|  20 | Converge             | Hell to Pay                 | hardcore-punk | heard in synthetic history; in previous generation B |

## Punk → Electronic

| Variant | Fresh vs history | Repeated from history | New vs previous B | Repeated from B | Mean adjacent BPM delta | Mean adjacent cosine distance |
| ------- | ---------------: | --------------------: | ----------------: | --------------: | ----------------------: | ----------------------------: |
| A       |            20/20 |                     0 |                 — |               — |                   33.99 |                       0.03343 |
| B       |            19/20 |                     1 |                 — |               — |                   28.19 |                       0.03436 |
| C       |            17/20 |                     3 |             19/20 |               1 |                   44.13 |                       0.05647 |
| D       |            17/20 |                     3 |             19/20 |               1 |                   44.13 |                       0.05647 |

All four lists contain 20 songs, preserve both endpoints and have 0 duplicate tracks/canonical families. With this seed, C and D happen to have identical ordering; their listening-history sets and freshness counts differ. BPM and cosine coverage are 100% in these lists. These measures are transition proxies, not approval of musical coherence.

**Listening checkpoint:** the route remains `punk → japanoise → industrial → electronic`. In A, The Undertones — “Here Comes the Summer” goes directly into Merzbow — “Ultra Marine Blues” (positions 4→5). This is a strong stylistic jump and needs explicit listening review. B/C/D vary the songs but retain the same stage transition.

### A — Neutral reference

|   # | Artist                 | Song                         | Stage      | Synthetic review marker |
| --: | ---------------------- | ---------------------------- | ---------- | ----------------------- |
|   1 | The Clash              | Rock the Casbah (Remastered) | punk       | fresh                   |
|   2 | The Jam                | Town Called Malice           | punk       | fresh                   |
|   3 | Stiff Little Fingers   | Here We Are Nowhere          | punk       | fresh                   |
|   4 | The Undertones         | Here Comes the Summer        | punk       | fresh                   |
|   5 | Merzbow                | Ultra Marine Blues           | japanoise  | fresh                   |
|   6 | Masonna                | Untitled 1                   | japanoise  | fresh                   |
|   7 | Prurient               | Mice Giant Mask              | japanoise  | fresh                   |
|   8 | Masonna                | Untitled 7                   | japanoise  | fresh                   |
|   9 | Merzbow                | Woodpecker No. 2             | japanoise  | fresh                   |
|  10 | John Wiese             | Garden Path Sentence         | japanoise  | fresh                   |
|  11 | Nine Inch Nails        | Mr. Self Destruct            | industrial | fresh                   |
|  12 | The Young Gods         | Kissing the Sun              | industrial | fresh                   |
|  13 | Skinny Puppy           | Assimilate                   | industrial | fresh                   |
|  14 | Front Line Assembly    | Mindphaser                   | industrial | fresh                   |
|  15 | Einstürzende Neubauten | Tanz Debil                   | industrial | fresh                   |
|  16 | Throbbing Gristle      | What a Day                   | industrial | fresh                   |
|  17 | M83                    | My Tears Are Becoming a Sea  | electronic | fresh                   |
|  18 | Caribou                | Home                         | electronic | fresh                   |
|  19 | Four Tet               | Unspoken                     | electronic | fresh                   |
|  20 | Aphex Twin             | Xtal                         | electronic | fresh                   |

### B — After listening to all of A

|   # | Artist                 | Song                         | Stage      | Synthetic review marker    |
| --: | ---------------------- | ---------------------------- | ---------- | -------------------------- |
|   1 | Dropkick Murphys       | The State Of Massachusetts   | punk       | fresh                      |
|   2 | Rancid                 | Time Bomb                    | punk       | fresh                      |
|   3 | The Clash              | Lost in the Supermarket      | punk       | fresh                      |
|   4 | The Jam                | The Eton Rifles              | punk       | fresh                      |
|   5 | Masonna                | Untitled VIII                | japanoise  | fresh                      |
|   6 | Merzbow                | Worms Plastic Earthbound     | japanoise  | fresh                      |
|   7 | Prurient               | Jean Jacket                  | japanoise  | fresh                      |
|   8 | Masonna                | Part I                       | japanoise  | fresh                      |
|   9 | Merzbow                | Woodpecker No. 2             | japanoise  | heard in synthetic history |
|  10 | John Wiese             | Bleskam (Action Sphere/Maya) | japanoise  | fresh                      |
|  11 | Nine Inch Nails        | Only                         | industrial | fresh                      |
|  12 | The Young Gods         | Skinflowers                  | industrial | fresh                      |
|  13 | Einstürzende Neubauten | Die Interimsliebenden        | industrial | fresh                      |
|  14 | Throbbing Gristle      | Hamburger Lady               | industrial | fresh                      |
|  15 | Skinny Puppy           | Smothered Hope               | industrial | fresh                      |
|  16 | Front Line Assembly    | The Blade                    | industrial | fresh                      |
|  17 | M83                    | Midnight City                | electronic | fresh                      |
|  18 | Kavinsky               | Grand Canyon                 | electronic | fresh                      |
|  19 | Daft Punk              | Digital Love                 | electronic | fresh                      |
|  20 | The Chemical Brothers  | Galvanize                    | electronic | fresh                      |

### C — Regenerate B without any new listening

|   # | Artist                 | Song                                      | Stage      | Synthetic review marker                              |
| --: | ---------------------- | ----------------------------------------- | ---------- | ---------------------------------------------------- |
|   1 | Descendents            | Hope                                      | punk       | fresh                                                |
|   2 | Rancid                 | Radio                                     | punk       | fresh                                                |
|   3 | Dropkick Murphys       | I'm Shipping Up To Boston                 | punk       | fresh                                                |
|   4 | The Clash              | Should I Stay or Should I Go (Remastered) | punk       | fresh                                                |
|   5 | Prurient               | S.T.D. Cocks                              | japanoise  | fresh                                                |
|   6 | Masonna                | Part Xxiv                                 | japanoise  | fresh                                                |
|   7 | Merzbow                | Ultra Marine Blues                        | japanoise  | heard in synthetic history                           |
|   8 | Masonna                | Untitled 7                                | japanoise  | heard in synthetic history                           |
|   9 | Merzbow                | Woodpecker No. 2                          | japanoise  | heard in synthetic history; in previous generation B |
|  10 | John Wiese             | Higashiikebukuro Bouquet Divisions        | japanoise  | fresh                                                |
|  11 | The Young Gods         | Our House                                 | industrial | fresh                                                |
|  12 | Einstürzende Neubauten | Sabrina                                   | industrial | fresh                                                |
|  13 | Throbbing Gristle      | Hot on the Heels of Love                  | industrial | fresh                                                |
|  14 | Skinny Puppy           | Worlock                                   | industrial | fresh                                                |
|  15 | Front Line Assembly    | Angriff                                   | industrial | fresh                                                |
|  16 | Nine Inch Nails        | March Of The Pigs                         | industrial | fresh                                                |
|  17 | M83                    | Wait                                      | electronic | fresh                                                |
|  18 | Kavinsky               | Nightcall                                 | electronic | fresh                                                |
|  19 | Daft Punk              | Aerodynamic                               | electronic | fresh                                                |
|  20 | The Prodigy            | Breathe                                   | electronic | fresh                                                |

### D — After listening to all of A and B

|   # | Artist                 | Song                                      | Stage      | Synthetic review marker                              |
| --: | ---------------------- | ----------------------------------------- | ---------- | ---------------------------------------------------- |
|   1 | Descendents            | Hope                                      | punk       | fresh                                                |
|   2 | Rancid                 | Radio                                     | punk       | fresh                                                |
|   3 | Dropkick Murphys       | I'm Shipping Up To Boston                 | punk       | fresh                                                |
|   4 | The Clash              | Should I Stay or Should I Go (Remastered) | punk       | fresh                                                |
|   5 | Prurient               | S.T.D. Cocks                              | japanoise  | fresh                                                |
|   6 | Masonna                | Part Xxiv                                 | japanoise  | fresh                                                |
|   7 | Merzbow                | Ultra Marine Blues                        | japanoise  | heard in synthetic history                           |
|   8 | Masonna                | Untitled 7                                | japanoise  | heard in synthetic history                           |
|   9 | Merzbow                | Woodpecker No. 2                          | japanoise  | heard in synthetic history; in previous generation B |
|  10 | John Wiese             | Higashiikebukuro Bouquet Divisions        | japanoise  | fresh                                                |
|  11 | The Young Gods         | Our House                                 | industrial | fresh                                                |
|  12 | Einstürzende Neubauten | Sabrina                                   | industrial | fresh                                                |
|  13 | Throbbing Gristle      | Hot on the Heels of Love                  | industrial | fresh                                                |
|  14 | Skinny Puppy           | Worlock                                   | industrial | fresh                                                |
|  15 | Front Line Assembly    | Angriff                                   | industrial | fresh                                                |
|  16 | Nine Inch Nails        | March Of The Pigs                         | industrial | fresh                                                |
|  17 | M83                    | Wait                                      | electronic | fresh                                                |
|  18 | Kavinsky               | Nightcall                                 | electronic | fresh                                                |
|  19 | Daft Punk              | Aerodynamic                               | electronic | fresh                                                |
|  20 | The Prodigy            | Breathe                                   | electronic | fresh                                                |

## Earlier acoustic references: provisional

These twenty-song references were collected before final performance tuning. Acoustic A/B/C/D and accepted p95 remain pending the index deployment. The album route resolves The Dillinger Escape Plan as a waypoint but contains no song by that artist: the current waypoint contract guides vectors/context rather than reserving a playable artist anchor.

### Concubine — Converge → To Our Friends in the Great White North — Botch

|   # | Artist                    | Song                                    |
| --: | ------------------------- | --------------------------------------- |
|   1 | Converge                  | Concubine                               |
|   2 | Year of the Knife         | Final Tears                             |
|   3 | Code Orange               | Bind You                                |
|   4 | Despised Icon             | Purgatory                               |
|   5 | Job For A Cowboy          | Grinding Wheels of Ophanim              |
|   6 | Bucket                    | Age of Ape and Men                      |
|   7 | Trap Them                 | Sanitations                             |
|   8 | Converge                  | Distance and Meaning (Live)             |
|   9 | Car Bomb                  | Secrets Within (Live)                   |
|  10 | Gojira                    | This Emptiness                          |
|  11 | Converge                  | For You                                 |
|  12 | Between The Buried And Me | Destructo Spin (2020 Remix / Remaster)  |
|  13 | Meshuggah                 | Stengah (Remastered 2006)               |
|  14 | Converge                  | Last Light                              |
|  15 | Mastodon                  | Ghost of Karelia (Live at Brixton)      |
|  16 | Viva Belgrado             | Erida                                   |
|  17 | Meshuggah                 | Violent Sleep of Reason                 |
|  18 | Car Bomb                  | Blackened Battery (Live)                |
|  19 | Life's Question           | Prayer For My Old Man                   |
|  20 | Botch                     | To Our Friends in the Great White North |

### Jane Doe — Converge → We Are the Romans — Botch

Waypoint: The Dillinger Escape Plan.

|   # | Artist                    | Song                                      |
| --: | ------------------------- | ----------------------------------------- |
|   1 | Converge                  | The Broken Vow                            |
|   2 | The Ocean                 | Equinox                                   |
|   3 | Gojira                    | Liquid Fire                               |
|   4 | Between The Buried And Me | Roboturner                                |
|   5 | The Armed                 | Local Millionaire                         |
|   6 | Botch                     | One Twenty Two (Live)                     |
|   7 | Killer Be Killed          | Face Down                                 |
|   8 | Incendiary                | Dissension                                |
|   9 | Higher Power              | Staring At The Sun                        |
|  10 | Defeater                  | Blood in My Veins                         |
|  11 | Sumac                     | Image of Control (II)                     |
|  12 | Envy                      | Chacun de tes pas                         |
|  13 | The Blood Brothers        | Cecilia and the Silhouette Saloon         |
|  14 | Car Bomb                  | Lower the Blade                           |
|  15 | Ninjaspy                  | Out of Tampons                            |
|  16 | These Arms are Snakes     | Crazy Woman Dirty Train                   |
|  17 | Jungle Rot                | Killing Spree                             |
|  18 | Norma Jean                | 1,000,000 Watts                           |
|  19 | Cave In                   | Ebola                                     |
|  20 | Botch                     | Transitions from Persona to Object (Demo) |

## Gates recorded at capture

- Review the actual musical transitions, especially punk→japanoise.
- Complete checkpoints 3.4/3.5 and remaining scoped QA.
- Record or resolve 20-step genre case over the 2s single-probe gate; do not treat the current sample as a p95.
- Measure complete acoustic paths after the cosine-index repair and route-scoped ANN expansion fix are deployed.
- Do not infer zero repetition or a percentage of musical correctness from these results.

The sanitized measurements, source hashes and environments are recorded in [music-paths-evaluation.json](music-paths-evaluation.json). Implementation details are in [Music Paths](../../music-paths.md).
