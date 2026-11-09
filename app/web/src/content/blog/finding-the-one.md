---
title: "Finding the one: where every bar starts"
description: "Smart Mix put phrase boundaries on the wrong beat. We replaced its bar heuristic, then had to fix how the model's beats became a grid."
date: 2026-11-10
tags: [Smart Mix, audio analysis, Python, Rust]
related: [smart-mix-planned-on-the-server, a-beat-grid-in-a-few-bytes, lyrics-as-labels]
sources:
  - app/crate/smart_mix/beat_model.py
  - app/crate/smart_mix/phrase_grid.py
  - app/crate/worker_handlers/analysis.py
  - tools/crate-cli/src/beat_tracking.rs
  - docs/technical/smart-mix-operations.md
  - tools/smart-mix-eval/structure
---

Start an incoming track one beat into a bar and its opening lands against the wrong part of the
outgoing bar. The tempo is right and the phrasing is wrong. On the first reference set of 25 tracks,
Crate's analyser picked the right first beat of the bar on only 10.

Smart Mix needs to know which beat starts each bar before it can place phrases of 8, 16 or 32 bars. In the
first version of the v7 analyser, we estimated that position from low-frequency onsets and chord changes.
For each of the four possible positions in a bar, the analyser scored how often those features landed there
and kept the strongest. Python and Rust used the same rule.

That rule often chose the wrong position. During the Smart Mix 3 work in November 2026, we replaced it with
modelled beats and downbeats. Integrating the model exposed another problem: a beat list that looks mostly
right can still shift every later bar if it contains a single extra beat.

The [earlier Smart Mix article](/blog/smart-mix-planned-on-the-server) explains how the server plans a
transition. This is the work needed to give that planner a usable bar grid.

## Establishing a reference

We needed to measure bar alignment across tracks. We used two existing systems as an automatic reference,
then compared Crate's bar positions against them.

[All-In-One](https://github.com/mir-aidj/all-in-one) predicts beats, downbeats and labelled musical sections
from separated audio stems. We ran it offline, then compared its downbeats with those from madmom's
independent downbeat network and decoder. Agreement between them gave us a subset on which to investigate
Crate's mistakes, without treating either model as a human annotation.

For the initial comparison, we used 25 tracks from genres that Smart Mix handles with phrase transitions,
where the two reference systems agreed on at least 90% of downbeats. Crate's heuristic matched the bar
position on 10. Its own structure-confidence score did not separate those matches from the failures.

Changing the bar position alone was insufficient. Some tracks had a grid at half the intended tempo; others
drifted against live recordings. Even choosing the best of the four positions left only 14 of the 25
matching the reference. We needed better beat timestamps as well as a better choice of the first beat.
[Initial comparison and design decision](https://github.com/thecrateapp/crate-decks/blob/0cc07d0825efdf6a7865bddf4888fc754af0ec8a/docs/plans/2026-11-02-smart-mix-3-design.md#L264-L292).

## Choosing a model we could run on the server

[Beat This!](https://github.com/CPJKU/beat_this) is a beat and downbeat tracker published at ISMIR 2024.
Its code and released weights use the MIT licence. On the initial 25-track comparison it matched the
reference bar position on 21 tracks, enough of an improvement to try it inside the analyser.

We then compared two checkpoints on 56 tracks. The smaller `small0` checkpoint agreed with All-In-One's
raw downbeats on 38 tracks; the larger `final0` agreed on 37. The smaller file was about 8 MB, against about
77 MB for the full model. We chose `small0`: that sample gave us no reason to pay for the larger one.
[Checkpoint comparison](https://github.com/thecrateapp/crate/blob/e2b2bd476a818f02b760a86d74cc2c77a833d3cd/docs/technical/smart-mix-operations.md#measurement-of-the-structure).

The model runs in the analysis worker before the rest of the profile calculation. The worker passes beat
timestamps, downbeat timestamps and the detected beats per bar to Rust through `crate-cli analyze --beats`.
The Python fallback accepts the same information. Neither analyser needs its own copy of the neural model.

Both analysers still fit a constant-tempo grid when the track supports one. That makes the model's output
an input to the existing grid calculation, rather than a replacement for every timing decision. When the
tempo moves, the analyser keeps the tracked beats instead.

## Turning downbeats into a bar position

A downbeat is the first beat of a bar. Crate's grid is an ordered list of beat timestamps, so a bar position
is an index modulo four: `0`, `1`, `2` or `3`. The model's downbeats vote for one of those positions.

Each downbeat inside the grid's time range, allowing 70 ms at either end, contributes to the denominator.
It votes only if the nearest grid beat is within 70 ms. The winning position must account for at least 60%
of the downbeats considered:

```python source="app/crate/smart_mix/phrase_grid.py#L56-L73" commit="e2b2bd476a818f02b760a86d74cc2c77a833d3cd" "min_share * counted"
    votes = [0] * BEATS_PER_BAR
    counted = 0
    for downbeat in downbeats_ms:
        if not grid[0] - tolerance_ms <= downbeat <= grid[-1] + tolerance_ms:
            continue
        counted += 1
        index = _nearest_beat(grid, downbeat)
        if abs(grid[index] - downbeat) <= tolerance_ms:
            votes[index % BEATS_PER_BAR] += 1
    if not counted:
        return None
    # On a tie the earlier phase wins; a tie never reaches a share above one half.
    phase = max(
        range(BEATS_PER_BAR), key=lambda candidate: (votes[candidate], -candidate)
    )
    if votes[phase] < min_share * counted:
        return None
    return int(grid[phase])
```

Counting unmatched downbeats in the denominator matters. If we counted only successful matches, a few
conveniently aligned beats could give a misleadingly strong vote while most of the model's downbeats fell
nowhere near the grid. With this rule, disagreement can leave the track without a bar anchor.

The Rust implementation uses the same tolerance and share. If no position passes, both analysers omit
phrases and the planner falls back to a crossfade. A detected three-beat bar is also kept out of the phrase
path: v7's phrase and transition code assumes four beats per bar. It records the time signature without
inventing a four-beat phrase grid.
[Python and Rust bar rules](https://github.com/thecrateapp/crate/blob/e2b2bd476a818f02b760a86d74cc2c77a833d3cd/docs/technical/smart-mix-operations.md#beats-and-downbeats).

## A good model still produced bad grids

Our first integration used Beat This!'s default peak picking. On a larger set of 127 tracks from genres
that use phrase transitions, 84 received a bar anchor, and 65 of those matched the All-In-One reference.
The old heuristic had produced
phrases for 104 tracks in that set. Replacing the tracker had reduced coverage, even though the new model
had looked much better in the first comparison.

Without post-processing, the model sometimes produced neighbouring beats only 80–100 ms apart. We saw
this in about half the tracks checked. On a track with a strong constant pulse, the grid fit could ignore
a stray detection. On a track that retained the model's beat list, the extra entry changed every later
index modulo four. A downbeat vote before that entry and one after it could now disagree about the bar
position even when both timestamps were close to the music.

![An extra detected beat shifts later beat indices modulo four, splitting the downbeat vote. Removing that beat keeps the model's downbeats on the same bar position.](/blog/finding-the-one/bar-phase.svg)

[View the diagram at full size](/blog/finding-the-one/bar-phase.svg).

Beat This! already offered an optional post-processor for this: madmom's dynamic Bayesian network, enabled
with `dbn=True`. It decodes the model's activations into a sequence of beats and positions in a bar, with
three or four beats per bar. That gives the grid a sequence constrained by a metrical model, instead of
independent peaks. [Beat This! inference options](https://github.com/CPJKU/beat_this#inference).

```python source="app/crate/smart_mix/beat_model.py#L108-L121" commit="e2b2bd476a818f02b760a86d74cc2c77a833d3cd" "dbn=True"
class BeatThisModel:
    """Beat This! on the CPU, with madmom's DBN, from a local checkpoint."""

    def __init__(self, path: Path, tracker: str) -> None:
        from beat_this.inference import Audio2Beats

        self.tracker = tracker
        self._model = Audio2Beats(checkpoint_path=str(path), device="cpu", dbn=True)

    def __call__(self, signal: np.ndarray, sample_rate: int) -> tuple[Any, Any]:
        import torch

        torch.set_num_threads(_torch_threads())
        return self._model(signal, sample_rate)
```

On the same 127-track set, the change produced this result:

| Integration | Tracks with a bar anchor | Anchors matching the reference |
| --- | ---: | ---: |
| Beat This! with peak picking | 84 | 65 |
| Beat This! with the DBN | 115 | 86 |

The number of usable anchors increased, as did the number that matched the reference. Accuracy among
anchored tracks did not increase: 65/84 is about 77%, while 86/115 is about 75%. The DBN recovered coverage;
it did not make every newly accepted track reliable.
[First integration measurement](https://github.com/thecrateapp/crate-decks/blob/0cc07d0825efdf6a7865bddf4888fc754af0ec8a/docs/plans/2026-11-02-smart-mix-3-implementation-plan.md#L432-L441).

In the subset where the two reference systems agreed, 34 of the 35 anchored tracks matched All-In-One
with the DBN. That was encouraging, but this subset was selected for agreement and was easier than the
whole sample. We kept coverage and agreement as separate measurements.

## Shipping the whole analysis path

`dbn=True` brought a packaging dependency with it. madmom's PyPI release did not build with the Python 3.13
environment we used for analysis. A separate Docker build stage compiled a wheel from a pinned source
revision; the final image installed the wheel without carrying the compiler toolchain. The checkpoint and
licence were also downloaded and checksum-verified when building the image. The worker never fetches
weights while analysing a track.

madmom separates its BSD source-code licence from the CC BY-NC-SA licence on its model files. Crate's
production path uses the decoder with Beat This!'s outputs and does not load madmom's trained networks.
The separate offline comparison does use its downbeat network.
[madmom licensing](https://github.com/CPJKU/madmom#license).

A failure to load the model must not prevent a track from getting a profile. Missing dependencies or
weights, model failures, empty beat results and tracks longer than 600 seconds leave the analyser using
its earlier tracker and heuristic. Missing madmom disables the model path entirely; we do not silently
return to peak picking. If an installed `crate-cli` cannot accept model beats, the worker uses the Python
analyser so it can still consume them.

The profile records the tracker name, `beat-this-small0-dbn`. Including the post-processing in that name
lets the system distinguish these results from the earlier `beat-this-small0` output. A fallback run also
cannot replace a stored profile whose beats came from the model with a weaker profile at the same quality.
[Integration and fallback behaviour](https://github.com/thecrateapp/crate/blob/e2b2bd476a818f02b760a86d74cc2c77a833d3cd/docs/technical/smart-mix-operations.md#beats-and-downbeats).

## Keeping the expensive result

On one thread of our development machine, `small0` used 12.8 CPU seconds for a 237-second track and 21.1
for a 367-second track. The DBN added roughly 0.8–1.0 CPU seconds. Those are two development measurements,
not a measured production-library backfill time. They were enough to make repeated inference expensive
for a library approaching 140,000 tracks.

Changing a phrase boundary rule should not require running the model on every file again. We added
`track_mix_signals` to keep its beats, downbeats and beats per bar separately from the derived profile.
The worker first looks up signals for the file's source revision, then checks the tracker identity:

```python source="app/crate/worker_handlers/analysis.py#L1404-L1411" commit="e2b2bd476a818f02b760a86d74cc2c77a833d3cd" "signals.beat_tracker == tracker"
    tracker = beat_tracker_name()
    if signals is not None and signals.beat_tracker == tracker and signals.beats_ms:
        return BeatTrack(
            tracker=tracker,
            beats_ms=signals.beats_ms,
            downbeats_ms=signals.downbeats_ms or (),
            beats_per_bar=signals.beats_per_bar,
        )
```

The revision uses file size, modification time and inode. A rename can reuse the signals; a normal retag
or replacement invalidates them. A rewrite that preserves all three values is invisible to this check.
The worker also checks the revision again before storing newly computed signals, so it does not knowingly
attach a result to a file that changed during analysis.

A later change to phrase segmentation can reuse these stored outputs and rerun the cheaper downstream
analysis. Changing the checkpoint or its post-processing changes the tracker name and causes inference
to run again. This is why keeping only the final phrases would have been insufficient: they discard the
beat evidence needed to try a different segmentation.
[Stored-signal format and invalidation](https://github.com/thecrateapp/crate/blob/e2b2bd476a818f02b760a86d74cc2c77a833d3cd/docs/technical/smart-mix-operations.md#stored-model-signals).

## What changed for Smart Mix

The final evaluation expanded to 145 tracks, with one extreme-metal track excluded from the results
for phrase transitions. On the remaining 144, the old heuristic produced phrases for 119 tracks. The integrated model
and DBN produced them for 131. Of those 131 anchored tracks, 97 met the reference-agreement test: at least
90% of All-In-One's downbeats inside the grid fell within 70 ms of Crate's bar starts.

The improvement gave the planner more tracks with model-derived bar positions, plus a defined way to
withhold phrases when the grid and model disagreed. It also left 34 anchored tracks below the agreement
threshold. A strong vote within Crate's own grid does not guarantee that the grid agrees with another
tracker, much less with a listener.

Finding bar starts also did not solve musical section placement. We subsequently added chroma and MFCC
features to the boundary score, alongside loudness and spectral balance. In the same evaluation, section
F1 within three seconds rose from 0.45 for the old heuristic to 0.49 with the model and DBN, then to 0.53
with those additional features. That measures how phrase cuts line up with All-In-One's section boundaries;
phrases are often shorter than sections, so the two are not expected to coincide everywhere.
[Evaluation method and full results](https://github.com/thecrateapp/crate/blob/e2b2bd476a818f02b760a86d74cc2c77a833d3cd/docs/technical/smart-mix-operations.md#measurement-of-the-structure).

The remaining tests need listening as well as model comparisons. All-In-One and madmom can agree and still
be wrong, and the chosen tracks do not represent every kind of music in a personal library. The
[structure evaluation tools](https://github.com/thecrateapp/crate/tree/e2b2bd476a818f02b760a86d74cc2c77a833d3cd/tools/smart-mix-eval/structure)
keep the reference outputs separate from Crate's profiles, so the same tracks can be compared again when
the grid or phrase rules change.
