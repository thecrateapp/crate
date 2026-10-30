# Music Paths: final checkpoint 3.4 catalog verification

> Historical capture: this report describes its recorded source snapshot before the reviewed fixes. Its measurements, warnings and approval notes do not validate the current implementation. See the [evidence index](README.md) and [current behavior](../../music-paths.md).

Status: five isolated read-only planning probes passed metadata/structural checks. These are single samples, not p95 acceptance, persistence/API migration coverage or musical approval. No deployment was performed.

The process loaded the current local source snapshot, including `crate.music_path_validation` before the service and the corresponding adapters. Every database connection was forced read-only. AI, cache writes, saved-path reads and persistence calls were guarded off. Redis issued only `GET`/`PING`; no forbidden operation was attempted. Source fingerprints are recorded in the accompanying JSON.

An empty synthetic listening history and the fixed seed `musical-rotation-controlled` were used. No actual listening history, private identifiers or library paths are present in this report.

| Case                             | Requested / actual | is_partial | generated_step_count | Warnings                                      | Single-probe time |
| -------------------------------- | -----------------: | ---------- | -------------------: | --------------------------------------------- | ----------------: |
| punk-to-electronic               |            20 / 20 | false      |                   20 | none                                          |            2.337s |
| electronic-to-punk               |            20 / 20 | false      |                   20 | none                                          |            1.950s |
| punk-to-electronic               |           100 / 97 | true       |                   97 | insufficient_tracks (expected 100, actual 97) |            3.756s |
| concubine-to-botch               |            20 / 20 | false      |                   20 | none                                          |            9.190s |
| jane-doe-to-romans-via-dillinger |            20 / 20 | false      |                   20 | none                                          |            8.294s |

All cases preserve both endpoints, contain zero duplicate track IDs/canonical song families and report the actual generated count. `is_partial` agrees with the warning list. The 100-step genre request returns 97 songs and explicitly reports `insufficient_tracks`, expected 100 / actual 97.

The corrected short bridge follows `punk → punk-rock → new-wave → electronic`, with its reverse matching the opposite direction. The album route resolves The Dillinger Escape Plan as its requested guide. A resolved guide constrains vector/context guidance; it does not promise a played track by that artist.

The acoustic timings still reflect the missing production cosine index and remain a performance limitation. The forward 20 genre sample also exceeds the 2s target. No 25-sample benchmark or end-to-end post-deploy result is claimed. Production schema-dependent saved-path reads/writes were never invoked.

## punk-to-electronic — 20 requested

Metadata: `is_partial=false`, `generated_step_count=20`, warning codes: none.

Stages: punk → punk-rock → new-wave → electronic.

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

## electronic-to-punk — 20 requested

Metadata: `is_partial=false`, `generated_step_count=20`, warning codes: none.

Stages: electronic → new-wave → punk-rock → punk.

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

## punk-to-electronic — 100 requested

Metadata: `is_partial=true`, `generated_step_count=97`, warning codes: insufficient_tracks.

Stages: punk → punk-rock → new-wave → electronic → ambient → funk → house → electronic.

|   # | Artist                                               | Song                                             | Stage      |
| --: | ---------------------------------------------------- | ------------------------------------------------ | ---------- |
|   1 | The Clash                                            | Rock the Casbah (Remastered)                     | punk       |
|   2 | The Jam                                              | Town Called Malice                               | punk       |
|   3 | Stiff Little Fingers                                 | Here We Are Nowhere                              | punk       |
|   4 | The Undertones                                       | Here Comes the Summer                            | punk       |
|   5 | Rancid                                               | Time Bomb                                        | punk       |
|   6 | Social Distortion                                    | Story of My Life                                 | punk       |
|   7 | Descendents                                          | Myage                                            | punk       |
|   8 | Black Flag                                           | Rise Above                                       | punk       |
|   9 | Misfits                                              | Astro Zombies                                    | punk-rock  |
|  10 | Hot Water Music                                      | Trusty Chords                                    | punk-rock  |
|  11 | The Menzingers                                       | Casey                                            | punk-rock  |
|  12 | Off With Their Heads                                 | Fuck This, I'm Out                               | punk-rock  |
|  13 | Propagandhi                                          | Anti-Manifesto                                   | punk-rock  |
|  14 | Dropkick Murphys                                     | The State Of Massachusetts                       | punk-rock  |
|  15 | Turbonegro                                           | Get It On                                        | punk-rock  |
|  16 | Zeke                                                 | I Don't Give A Fuck                              | punk-rock  |
|  17 | Frank Carter & The Rattlesnakes                      | Juggernaut                                       | punk-rock  |
|  18 | SOFT PLAY                                            | Hey                                              | punk-rock  |
|  19 | Amyl and The Sniffers                                | Hertz                                            | punk-rock  |
|  20 | Die Spitz                                            | Hair of Dog                                      | punk-rock  |
|  21 | Upchuck                                              | Freaky                                           | punk-rock  |
|  22 | Bad Nerves                                           | Baby Drummer                                     | punk-rock  |
|  23 | New Order                                            | Age of Consent                                   | new-wave   |
|  24 | Joy Division                                         | She's Lost Control (2007 Remaster)               | new-wave   |
|  25 | The Cure                                             | Friday I'm In Love                               | new-wave   |
|  26 | Depeche Mode                                         | Strangelove                                      | new-wave   |
|  27 | Gary Numan                                           | M.E.                                             | new-wave   |
|  28 | Killing Joke                                         | Love Like Blood                                  | new-wave   |
|  29 | Public Image Ltd.                                    | Rise                                             | new-wave   |
|  30 | The Fall                                             | Lost in Music                                    | new-wave   |
|  31 | Wire                                                 | Outdoor Miner (2006 Remastered Version)          | new-wave   |
|  32 | Gang Of Four                                         | Return the Gift                                  | new-wave   |
|  33 | Television                                           | See No Evil                                      | new-wave   |
|  34 | The Smiths                                           | Heaven Knows I'm Miserable Now (2011 Remaster)   | new-wave   |
|  35 | Public Image Ltd.                                    | Albatross                                        | new-wave   |
|  36 | Killing Joke                                         | Eighties (2007 Digital Remaster)                 | new-wave   |
|  37 | M83                                                  | Midnight City                                    | electronic |
|  38 | Caribou                                              | Sun                                              | electronic |
|  39 | Four Tet                                             | As Serious As Your Life                          | electronic |
|  40 | Aphex Twin                                           | Heliosphan                                       | electronic |
|  41 | Flying Lotus                                         | Crust                                            | electronic |
|  42 | Amon Tobin                                           | Slowly                                           | electronic |
|  43 | The Chemical Brothers                                | Hey Boy Hey Girl                                 | electronic |
|  44 | The Prodigy                                          | Smack My Bitch Up                                | electronic |
|  45 | ORBITAL                                              | The Girl with the Sun in Her Head                | electronic |
|  46 | Underworld                                           | Sola Sistim                                      | electronic |
|  47 | Death In Vegas                                       | Girls                                            | electronic |
|  48 | Fluke                                                | Atom Bomb                                        | electronic |
|  49 | Daft Punk                                            | Something About Us                               | electronic |
|  50 | LCD Soundsystem                                      | Home                                             | electronic |
|  51 | Boards of Canada                                     | Music Is Math                                    | ambient    |
|  52 | The Future Sound Of London                           | Flak                                             | ambient    |
|  53 | Loscil                                               | Endless Falls                                    | ambient    |
|  54 | How to Disappear Completely                          | Seraph III                                       | ambient    |
|  55 | Mount Shrine                                         | Subtotem                                         | ambient    |
|  56 | The Void Wanderer                                    | Watch Me Fade Away                               | ambient    |
|  57 | Dead Can Dance                                       | The Host of Seraphim                             | ambient    |
|  58 | Chelsea Wolfe                                        | Oui Oui Marie                                    | ambient    |
|  59 | Emma Ruth Rundle                                     | Marked for Death                                 | ambient    |
|  60 | Burial                                               | Archangel                                        | ambient    |
|  61 | Kevin Richard Martin                                 | Bad Dream                                        | ambient    |
|  62 | Bohren & Der Club Of Gore                            | Karin                                            | ambient    |
|  63 | Lustmord                                             | Goetia                                           | ambient    |
|  64 | Final                                                | The Light Orchestra                              | ambient    |
|  65 | Glass Beams                                          | Mahal                                            | funk       |
|  66 | Primus                                               | DMV                                              | funk       |
|  67 | Karriem Riggins                                      | Tom Toms                                         | funk       |
|  68 | Speed                                                | A Choice To Survive                              | funk       |
|  69 | Whispers                                             | Bangkok Evilcore                                 | funk       |
|  70 | Glass Beams                                          | Black Sand                                       | funk       |
|  71 | Demonstration Of Power                               | Wisenheimer (You Were Never One Of Us)           | funk       |
|  72 | Kickback                                             | Yom-Ma-Lok                                       | funk       |
|  73 | Whispers                                             | This Is Not The End                              | funk       |
|  74 | Primus                                               | Too Many Puppies                                 | funk       |
|  75 | Karriem Riggins                                      | Summer Maddness S.A.                             | funk       |
|  76 | Mano Le Tough                                        | Baby, Let's Love                                 | house      |
|  77 | Swayzak                                              | Make Up Your Mind                                | house      |
|  78 | Verses GT                                            | Fragment                                         | house      |
|  79 | John Talabot                                         | Oro y Sangre                                     | house      |
|  80 | 808 State                                            | Pacific 202                                      | house      |
|  81 | Herr Styler                                          | Jack                                             | house      |
|  82 | Daft Punk                                            | Digital Love                                     | house      |
|  83 | Mano Le Tough                                        | They Fell into Silence                           | house      |
|  84 | George Riley, Jacques Greene, Nosaj Thing, Verses GT | Your Light                                       | house      |
|  85 | Jacques Greene, Nosaj Thing, TYSON, Verses GT        | Angels                                           | house      |
|  86 | Jacques Greene                                       | Devoted                                          | house      |
|  87 | Verses GT                                            | Found                                            | house      |
|  88 | Jacques Greene, Nosaj Thing, Verses GT               | Left                                             | house      |
|  89 | Daft Punk, Pharrell Williams                         | Lose Yourself to Dance (feat. Pharrell Williams) | house      |
|  90 | Jungle                                               | Busy Earnin’                                     | electronic |
|  91 | Moderat                                              | A New Error                                      | electronic |
|  92 | Modeselektor                                         | Un amigo malo                                    | electronic |
|  93 | Trentemøller                                         | Blue Hotel                                       | electronic |
|  94 | Vitalic                                              | La Rock 01                                       | electronic |
|  95 | Fischerspooner                                       | Just Let Go                                      | electronic |
|  96 | Zoot Woman                                           | Grey Day                                         | electronic |
|  97 | Gold Panda                                           | You                                              | electronic |

## concubine-to-botch — 20 requested

Metadata: `is_partial=false`, `generated_step_count=20`, warning codes: none.

|   # | Artist             | Song                                    | Stage |
| --: | ------------------ | --------------------------------------- | ----- |
|   1 | Converge           | Concubine                               | —     |
|   2 | Year of the Knife  | Final Tears                             | —     |
|   3 | Terror             | Back At You                             | —     |
|   4 | Converge           | Distance and Meaning (Live)             | —     |
|   5 | Trap Them          | Sanitations                             | —     |
|   6 | Botch              | One Twenty Two (Live)                   | —     |
|   7 | Killer Be Killed   | Face Down                               | —     |
|   8 | Touché Amoré       | Scene Is to Be Seen                     | —     |
|   9 | Gojira             | This Emptiness                          | —     |
|  10 | Converge           | For You                                 | —     |
|  11 | Life's Question    | Mellow My Mind                          | —     |
|  12 | Meshuggah          | Stengah (Remastered 2006)               | —     |
|  13 | Converge           | Last Light                              | —     |
|  14 | Mastodon           | Ghost of Karelia (Live at Brixton)      | —     |
|  15 | Immolation         | The Weight Of Devotion                  | —     |
|  16 | Modern Life Is War | The Motorcycle Boy Reigns               | —     |
|  17 | Norma Jean         | Funeral Singer                          | —     |
|  18 | Car Bomb           | Blackened Battery (Live)                | —     |
|  19 | Meshuggah          | Violent Sleep of Reason                 | —     |
|  20 | Botch              | To Our Friends in the Great White North | —     |

## jane-doe-to-romans-via-dillinger — 20 requested

Metadata: `is_partial=false`, `generated_step_count=20`, warning codes: none.

Resolved guide: The Dillinger Escape Plan.

|   # | Artist                           | Song                              | Stage |
| --: | -------------------------------- | --------------------------------- | ----- |
|   1 | Converge                         | Fault and Fracture                | —     |
|   2 | The Number Twelve Looks Like You | Don't Get Blood on My Prada Shoes | —     |
|   3 | Despised Icon                    | Purgatory                         | —     |
|   4 | Converge                         | Distance and Meaning (Live)       | —     |
|   5 | Emmure                           | A.I.                              | —     |
|   6 | Protest The Hero                 | No Stars Over Bethlehem           | —     |
|   7 | Periphery                        | CHVRCH BVRNER                     | —     |
|   8 | Incendiary                       | Dissension                        | —     |
|   9 | Higher Power                     | Staring At The Sun                | —     |
|  10 | Combust                          | Atlas                             | —     |
|  11 | Comeback Kid                     | The Concept Stays                 | —     |
|  12 | The Number Twelve Looks Like You | Rise Up Mountain                  | —     |
|  13 | Better Lovers                    | Sacrificial Participant           | —     |
|  14 | Defeater                         | Blood in My Veins                 | —     |
|  15 | Sumac                            | Image of Control (II)             | —     |
|  16 | Car Bomb                         | Lower the Blade                   | —     |
|  17 | The Blood Brothers               | Cecilia and the Silhouette Saloon | —     |
|  18 | Earth Crisis                     | Arc Of Descent                    | —     |
|  19 | These Arms are Snakes            | Crazy Woman Dirty Train           | —     |
|  20 | Botch                            | Mondrian Was a Liar (Demo)        | —     |

Sanitized evidence and source fingerprints: [music-paths-final-evaluation.json](music-paths-final-evaluation.json).
