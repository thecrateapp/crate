---
title: "Giving Smart Mix a sense of musical structure"
description: "A quieter transition can still skip too much music. Smart Mix 3 compares phrase-based candidates while keeping v2's fallback and player contract."
date: 2026-11-10
visuals: [smart-mix]
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 34
related: [finding-the-one, lyrics-as-labels, smart-mix-planned-on-the-server]
tags: [How to dismantle Spotify, Smart Mix, audio, DSP, history]
sources:
  - app/crate/smart_mix/structure.py
  - app/crate/smart_mix/beat_model.py
  - app/crate/smart_mix/candidates.py
  - app/crate/smart_mix/refinement.py
  - app/crate/smart_mix/versions.py
  - app/crate/db/repositories/smart_mix_signals.py
  - app/tests/test_smart_mix_candidates.py
  - app/tests/smart_mix_candidate_cases.py
  - app/crate/smart_mix/evaluation.py
  - docs/technical/smart-mix-operations.md
  - tools/smart-mix-eval/README.md
---

_Part 34. The Smart Mix 3 work merged after v3.2.4, through early November 2026._

Two tracks can share a tempo and still make an awkward transition. The beats line up, but the new
vocal arrives over the old one. Or a neat sixteen-bar blend starts halfway through a musical phrase.
The player executes its plan correctly and the choice still sounds wrong.

Smart Mix v2 knew about tempo, key, loudness, active audio and cue points. It could fit a transition
to a bar grid and respect limits on stretching and gain. Its picture of the track was much thinner
between those points. We added phrase boundaries and voice estimates so it could compare several places to mix.
That helped it avoid vocal clashes. It also made it much better at leaving music out.
[The earlier planner](/blog/smart-mix-planned-on-the-server) explains the v2 starting point.

## Less vocal clash, more music left behind

In a comparison of 184 transitions drawn from 64 tracks, both planners read the same phrase-enabled
profiles in DJ mode. The drop in estimated vocal clash was large. So was the increase in music
omitted at either end of the transition:

| Plan measurement | v2 | v3 |
| --- | ---: | ---: |
| Mix starts aligned to phrase boundaries | 0.5% | 78.3% |
| All four mix boundaries aligned | 0.0% | 15.8% |
| Mean estimated vocal clash | 2,481 ms | 70 ms |
| Mean outgoing music left after the mix | 1,395 ms | 24,168 ms |
| Mean incoming music skipped before the mix | 1,100 ms | 15,097 ms |
| Plans violating the checked policy | 0 of 184 | 0 of 184 |

On average, v3 left about 24 seconds of outgoing music after its mix, against 1.4 seconds for v2.
It skipped about 15 seconds of the incoming track, against 1.1 seconds. Earlier exits and later
entries can avoid two voices meeting, but those seconds may contain music we wanted to hear.

We needed to inspect where the planner put each transition, alongside its score. A position penalty
can charge for omitted music; listening is still how we judge whether a particular cut works.
[v2 report](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/smart-mix-eval/baselines/dev-2026-11-06-sm2/spike/smart-mix-v2-dj.report.md),
[v3 report](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/smart-mix-eval/baselines/dev-2026-11-06-sm2/spike/smart-mix-v3-dj.report.md).

These measurements describe generated plans and stored signals. They do not measure what a listener
heard, and a voice estimate can be wrong.

## Move the transition and inspect the cost

The figure below shows that choice on two synthetic tracks from Crate's candidate tests. Their
phrases, energy and voice values are test inputs, and the plans are what the Python planner returns
for them. They are not part of the library evaluation above.
[The voiced DJ fixture](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/smart_mix_candidate_cases.py).

Each track has its own timeline, showing its phrases, their energy and which phrases contain a
voice. The highlighted windows are the parts that play together. The middle lane is the mix itself:
wherever both decks have a voice and both gains are at half or more, the figure counts clash.
Hatched amber is active music the plan leaves out. **v2 · default** shows the plan Crate serves by
default, **v3 · structure** walks through the v3 menu to its first choice, and **v3 · no structure**
shows v3 with phrases and voice removed from both tracks. No audio plays.

<div data-blog-visual="smart-mix"></div>

The baseline mixes the outgoing outro into the incoming intro. In this fixture, both contain a
voice. Its estimated clash lasts 19.42 seconds, but it keeps all the active music. V3's first choice
moves the exit to an earlier break: the clash disappears, and 92.16 seconds of the outgoing track
remain after the mix. The alternative exits later and enters after the incoming intro. It leaves
15.36 seconds at the outgoing end and skips 30.72 seconds at the incoming start.

All three pass the policy checks, even though they play different portions of the two tracks. The phrase labels matter too: the scoring rule exempts music labelled intro or outro
from its position penalty. The figure counts all omitted active music, so that exemption cannot
hide it from the comparison.

The track timelines use source time. Both test tracks run at 125 BPM, so their windows advance at
the same rate. With a tempo adjustment, the incoming window would cover a different amount of
source audio. **v3 · no structure** shows the v2 fallback. Missing voice data makes the clash
estimate unavailable; it does not make either track instrumental.

## Keeping the candidate menu small

The generator limits the search before it scores anything. With phrases available, v3 considers the last four outgoing phrases that admit a mix and the first
three incoming phrases. Candidate durations include eight, sixteen or thirty-two outgoing bars and
the context's preferred duration. Longer blends need permission from that context. Candidates also
vary the bass handoff and permitted fade curves.

The planner ranks candidates using phrase alignment, energy at the handoff, harmonic compatibility,
tempo stability, bass overlap and music left out. Voice overlap adds a penalty when both profiles
support it. The position term charges for skipped incoming music and unplayed outgoing music, while
allowing phrases labelled intro or outro to be cut without that charge. A wrong phrase kind can
therefore affect the choice even when the timing arithmetic is correct.
[Candidate generator](https://github.com/thecrateapp/crate/commit/6606b09ad16b51efd16afb47a321a82be9a4b623).

We include v2's own plan among the options before ranking. It can reach a tail after the last detected phrase or a lead-in
before the first one, places a phrase-start-only search would miss. It still has to survive the ranking
and the limit of eight candidates. If either track lacks usable
structure, the first candidate stays exactly the v2 plan:

```python source="app/crate/smart_mix/candidates.py#L255-L269" commit="6606b09ad16b51efd16afb47a321a82be9a4b623" "baseline"
    edge = _edge(outgoing, incoming, context, policy, baseline)
    outgoing_phrases = _timeline(outgoing, policy)
    incoming_phrases = _timeline(incoming, policy)
    if outgoing_phrases is not None and incoming_phrases is not None:
        options = _phrase_options(edge, outgoing_phrases, incoming_phrases)
        if options:
            # v2's own plan stays on the menu, scored on the same phrases: it can
            # mix in the tail after the last phrase or over the incoming lead-in,
            # which no phrase start reaches.
            options.append(
                _fixed_option(edge, baseline, outgoing_phrases, incoming_phrases)
            )
            return _menu(edge, _ranked(options, policy))
    first = _fixed_option(edge, baseline, None, None)
    return _menu(edge, [first, *_ranked(_heuristic_options(edge, baseline), policy)])
```

The menu contains at most eight distinct valid plans. Every candidate passes the same typed
`TransitionPlan` validation and policy checks on tempo, gain, peak and duration. Tests compare v2
against a fixed fixture and verify the v3 fallback with two unstructured profiles, one structured
side, and an explicitly empty segmentation.
[Candidate contracts](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_smart_mix_candidates.py#L74-L181),
[v2 fixture protection](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_smart_mix_candidates.py#L261-L268).

![The outgoing track offers its last four eligible phrase starts and the incoming track its first three, mixed over 8, 16 or 32 bars or the context's preferred duration. Stored profiles feed at most eight validated plans, including v2's own. The deterministic winner is usable without a model call; an optional model proposal, off by default, must be reconstructed and validated, and a rejection leaves the deterministic plan in place. Phrase positions are illustrative.](/blog/giving-smart-mix-a-sense-of-musical-structure/phrases-to-plans.svg)


That fallback needed its own evaluation. The first set contained 300 edges with v5 profiles. v2 and v3 produced identical plans.
That was useful evidence for fallback compatibility, but it could not evaluate structure: none of
those profiles had phrases. The 184-transition comparison above used v7 analysis with phrases instead.
[Dataset provenance](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/tools/smart-mix-eval/README.md#L130-L157).


## The difficult part is measuring a phrase

A regular grid makes it possible to say “start sixteen bars before the end.” It cannot tell whether
those bars contain an outro, a final vocal passage or a quiet break. Cutting at a fixed interval is
only useful when the music happens to agree with that interval.

There are models that predict more of this structure directly. [All-In-One](https://github.com/mir-aidj/all-in-one)
predicts beats, downbeats, section boundaries and labels such as verse and chorus. We used it as an
offline reference for Crate's structure measurements. That gave us an independent comparison, though
another model's boundaries are not human annotations.

For the runtime pipeline, we combined model outputs with our own segmentation. [Beat This!](https://github.com/CPJKU/beat_this)
supplies beat and downbeat predictions. Crate runs its small checkpoint with DBN post-processing,
then fits and anchors the grid used by the rest of the analyzer. A novelty calculation identifies
changes around bar boundaries, and a dynamic programme chooses phrases of eight, sixteen or
thirty-two bars.
[Beat integration](https://github.com/thecrateapp/crate/commit/6e43b2e29043c44009afb4710ca235c37d6295c6),
[DBN post-processing](https://github.com/thecrateapp/crate/commit/51c27f0cf8533e5188c7b9d939d43a13725650a8).

The DBN was a correction to the first model integration. More raw predictions did not automatically
produce more usable downbeat anchors. Crate needed consistent positions on its fitted grid. The
model and the rule that accepts its output had to be evaluated together. [Finding the one](/blog/finding-the-one)
explains that work in detail.

Meter needed an explicit boundary too. The phrase planner counts bars of four. When the model reports
a stable meter other than four, the analyzer now keeps that meter in the profile and omits the
downbeat anchors and phrases. A track in three goes to crossfade instead of acquiring an invented
four-beat arrangement. If no usable model output is available, analysis can use its own tracker and
heuristics, with the fallback logged.
[Meter and fallback rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md#L263-L284).

### A tiny variance was creating extra boundaries

Our first structure calculation compared level and spectral-band balance around each bar boundary.
That catches a change from a sparse passage to a dense one, but a musical change need not get louder.
A new harmony or instrument can matter even when the overall level stays steady.

We added mean chroma and thirteen MFCC coefficients per bar. Chroma supplies a measure of harmonic
change; MFCCs supply a measure of timbral change. The calculation compares the four bars before a
boundary with the four after it, leaving gap bars out. These are numerical cues for segmentation,
not names for the chords or instruments.
[Harmony and timbre novelty](https://github.com/thecrateapp/crate/commit/6349755d0bc850ba92bf2c658fd62c8a553bae48).

The timbre normalization exposed a small but consequential bug. Standardizing a nearly constant MFCC
coefficient by its tiny standard deviation made minute fluctuations look like large changes. A
near-static loop could be split every eight bars. We added a floor of 1.0 to the divisor:

```python source="app/crate/smart_mix/structure.py#L443-L458" commit="2e3adbedcf0b28614b2217102ed7f8cee14424ee" "MFCC_STD_FLOOR"
def _standardized_columns(rows: list[list[float]]) -> list[list[float]]:
    """Each column minus its mean, over its standard deviation or ``MFCC_STD_FLOOR``.

    The larger of the two, so a column that barely moves keeps its differences small.
    """
    if not rows:
        return []
    columns = []
    for column in zip(*rows, strict=True):
        mean = _mean(column)
        deviation = math.sqrt(
            _mean([(value - mean) * (value - mean) for value in column])
        )
        scale = deviation if deviation > MFCC_STD_FLOOR else MFCC_STD_FLOOR
        columns.append([(value - mean) / scale for value in column])
    return [list(row) for row in zip(*columns, strict=True)]
```

That preserves small differences when a feature barely moves. The resulting novelty still has to
pay a boundary cost before the dynamic programme adds a split. Harmony alone cannot pay that cost;
it contributes alongside changes in level, balance or timbre.
[The variance correction](https://github.com/thecrateapp/crate/commit/2e3adbedcf0b28614b2217102ed7f8cee14424ee),
[segmentation rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md#L156-L182).

Each stored phrase has a starting beat and time, a bar count, an energy estimate, an energy change
and a heuristic kind. The profile also stores one energy byte per bar and a structure confidence.
Old profiles have null structure. An empty phrase list with confidence zero means analysis ran but
could not segment the track. The distinction lets a backfill and a planner treat missing work
differently from an analyzer that declined to make a useful claim.
[Storage semantics](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md#L184-L198).

We checked the resulting structure against boundaries from other automatic analyzers. Against All-In-One on 144 phrase-mixed tracks, section F1 within
three seconds moved from 0.45 for the old heuristic to 0.49 with Beat This! and its DBN, then 0.53
after adding harmony and timbre novelty. That gives us a measure of agreement with the reference. It does not tell us which
transition sounds better.
[Structure comparison](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md#L398-L440).


### Quiet music can still contain a voice

Energy cannot reliably identify a vocal. A dense instrumental passage can be loud; a quiet vocal
can still clash with the next singer. We added voice estimates from [YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet),
a model trained to classify AudioSet sound events. Crate uses the relevant speech and singing classes
and aggregates its short-window outputs into each phrase.

We calibrated the threshold with synchronized lyrics as imperfect labels. A line timestamp can
suggest where a voice is present, but it misses backing vocals and ad-libs and can be wrong itself.
The detector also has genre-dependent weaknesses. [Lyrics as labels](/blog/lyrics-as-labels) covers
the calibration, including why a voice score must not be treated as a transcript or a universal
probability of singing.

When both tracks have voice measurements, the planner penalizes their estimated overlap. The
evaluation counts voiced overlap only while both crossfade envelopes are at least half amplitude
(about −6 dB), so quiet fade tails do not contribute. It samples at 10 ms intervals and excludes
the separate staging gains from this threshold.
[Clash measurement](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/smart_mix/evaluation.py#L593-L634).
If either measurement is missing, the vocal term remains unavailable. Unknown voice data does not
mean instrumental music.
[Voice-overlap scoring](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/smart_mix/candidates.py#L877-L912).

## Reusing signals when the rules change

Adding models changes the cost of reanalysis. If we adjust a phrase boundary rule, rerunning the
beat tracker and voice detector on every file would repeat work whose inputs had not changed.

We therefore stored their outputs separately from the final profile in `track_mix_signals`. The row
contains beats, downbeats, meter and voice-window bytes, together with the model identifiers and
source revision. A later analyzer can recompute phrases and aggregate the stored voice windows
without running either model again.
[Reusable model signals](https://github.com/thecrateapp/crate/commit/696147218e65787383639939a81e507faeaa4209).

Reuse requires both the same source revision and the expected detector identity. A changed
checkpoint or post-processing algorithm gets a different identifier. Writes also compare source
revisions and read times so a slow task analyzing an old file cannot replace signals from a newer
read. A failed signal-cache read falls back to computation; it does not make the profile impossible
to build.
[Signal persistence and failure handling](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md#L340-L395).

The source revision uses size, modification time and inode. It is not a content hash. Rewriting audio
while preserving all three can retain stale signals even when a reanalysis is requested. That is a
real limit of the cache key, and one reason the revision has to remain visible in the operational
model.

## Returning a plan while refinement runs

The deterministic winner is sufficient to return a plan. Optional AI refinement runs asynchronously
and can select a candidate, shift either phrase by one position, move to an adjacent allowed length,
or change the bass handoff. It cannot supply arbitrary milliseconds, tempo ratios or gains.

The server reconstructs the proposal using the same candidate geometry and validates it again. A
response below the confidence threshold, an unknown candidate or an out-of-range change is rejected.
The final check is independent of the model's explanation:

```python source="app/crate/smart_mix/refinement.py#L268-L274" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243"
    except ValueError:
        return outcome("plan_invalid")
    if plan is None:
        return outcome("plan_invalid")
    if policy_violations(plan, outgoing, incoming, context=context, policy=policy):
        return outcome("policy_violation")
    return outcome(None, plan)
```

A rejected or unavailable refinement leaves the deterministic plan usable. The worker also requires
the same profile revisions when it reconstructs the menu; an answer for old analysis cannot silently
become the answer for new audio. The refinement key includes the profile revisions, context, prompt
and accepted AI configuration.
[Refinement lifecycle](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md#L860-L914).

This path is off by default. It needs the server setting, a model binding, the client's option and
`aiRefinement: true` on a v3 edge, along with the relevant permissions and token scope. Without those, the deterministic planner supplies the transition.

Crate still served v2 by default when this work merged. A caller had to
request `smart-mix-v3`; the wire plan remained version 2 because its fields kept the same meaning.
[Version contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/smart_mix/versions.py#L6-L35).

The chapter began with two problems: voices landing on voices, and blends that start in the middle
of a phrase. On the 184-transition comparison, v3's plans reduced the mean estimated vocal clash
from about 2.5 seconds to 70 ms and started 78% of mixes on a phrase boundary. They also left about
24 seconds of the outgoing track unplayed on average. Structure gave the planner better places to
cut, but it also gave it more music to skip. Whether a given cut sounds right still has to be judged
by listening.

## After the merge

The optional refinement was measured next. On 7 November, an evaluation sent the v3 menus of 184
phrase edges and 112 edges between electronic tracks to Gemini 3.8 Flash and Gemini 3.1 Pro, then
rendered the transitions and scored them with automatic listening metrics. Most rejections in the
first run were a balanced bass handoff requested on a crossfade candidate, which validation has
to refuse. The menu had never said that this handoff needs a beatmatch. Once each candidate
listed the handoffs it accepts, rejections fell to 0–3 %.
[Bass handoff fix](https://github.com/thecrateapp/crate/commit/8972fcd133a780ff45251acc5b73388da2c75ca7).

Fewer rejections did not make the plans better. In one run with the corrected menu, Gemini 3.8
Flash changed 46 of the 184 phrase edges, mostly towards intros and phrases without voice, as the
prompt's guidance asked. Those moves worsened the energy step and the vocal clash, which the v3
score already weighed when it ranked those candidates lower. Overall, the refined plans improved
none of the evaluation criteria and made the electronic transitions measurably worse: 5 better,
16 worse. The refinement's acceptance gate, SG3, closed as no-go. The setting stays off and the
capability reports AI assistance as unavailable; the action and its prompt remain so a later
experiment can rerun the same evaluation. Plans still come from the deterministic planners, with
v2 as the default.
[Prompt experiment](https://github.com/thecrateapp/crate/commit/4f88f89bb2136609d54100d54ec7f53cc9e2361e),
[SG3 decision](https://github.com/thecrateapp/crate/blob/8d1430fa09e0fe8630da2984eb8b482728da9fa7/docs/technical/smart-mix-operations.md#L973-L985),
[default planner](https://github.com/thecrateapp/crate/blob/8d1430fa09e0fe8630da2984eb8b482728da9fa7/docs/technical/smart-mix-operations.md#L113-L129).

Analyzer v8 reached main with that decision, on 8 November. v7 had measured the steadiness of
Beat This!'s beats as if they came from Crate's own tracker, so a stretch where the DBN held half
the tempo, the model's 20 ms frames and, at the cues, attacks scattered around a steady pulse all
read as an unsteady tempo. v8 measures model beats on the track's constant grid. On the 120
electronic tracks, median tempo stability went from 0.84 to 1.00, and the planners beatmatched 53
of the 112 edges instead of 39. The grid, downbeats and phrases are v7's, so the structure
comparison with All-In-One still holds. v8 is also the first analyzer version to reuse the stored
model signals: a track v7 analysed whose file has not changed is recomputed without running either
model again.
[Analyzer v8](https://github.com/thecrateapp/crate/blob/8d1430fa09e0fe8630da2984eb8b482728da9fa7/docs/technical/smart-mix-operations.md#L152-L198),
[signal reuse](https://github.com/thecrateapp/crate/blob/8d1430fa09e0fe8630da2984eb8b482728da9fa7/docs/technical/smart-mix-operations.md#L802-L808).
