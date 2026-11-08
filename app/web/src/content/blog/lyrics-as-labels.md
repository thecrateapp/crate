---
title: "Lyrics as labels: calibrating a voice detector without listening"
description: "Smart Mix needed voice labels for its phrases. We compared detectors against synced lyrics, chose YAMNet and stored scores we could recalibrate."
date: 2026-12-08
tags: [Smart Mix, audio analysis, machine learning, Python]
sources:
  - app/crate/smart_mix/vocals.py
  - app/crate/smart_mix/voice_model.py
  - app/crate/smart_mix/models.py
  - app/tests/test_smart_mix_voice_model.py
  - tools/smart-mix-eval/vocals
  - docs/technical/smart-mix-operations.md
related: [smart-mix-planned-on-the-server, a-beat-grid-in-a-few-bytes, finding-the-one]
draft: true
---

A transition can line up the beats and still put two singers on top of each other. For Smart Mix 3, we
needed to tell the transition planner which phrases contained a voice. The analyser already divided tracks
into phrases; it had no useful way to distinguish a verse from an instrumental passage.

Our first attempt was a spectral heuristic. It marked 13 of 322 phrases across 28 development tracks as
voiced, and missed entire tracks with obvious singing. We left it disabled. Before adding a model to every
analysis job, we needed a way to compare its output with the audio.

## Turning lyrics into a reference

[LRCLIB](https://lrclib.net/docs) provides lyrics in LRC format, with timestamps attached to lines. We treated
a line with words as evidence of voice from its timestamp until the next line, capped at six seconds.
Empty lines and instrumental markers added no voiced interval. For each phrase, we measured how much of
its duration those intervals covered: at least 25% gave it a voiced label; zero coverage gave it an unvoiced
label. We left the phrases in between out of the evaluation.

Those are proxy labels. A line timestamp does not say when the last syllable ends, and lyrics can omit
backing vocals, spoken samples or ad-libs. An unvoiced label means that our lyric rule found no voice in that
phrase. It does not establish that nobody sang there.

We also rejected a lyric match when its track duration differed from the audio by more than two seconds.
That caught some mismatched versions before their timestamps could become labels for the wrong recording.

## Comparing three models on CPU

The first comparison covered 64 tracks, about 254 minutes of audio, mostly post-punk and industrial.
There were 649 phrases. Lyrics supplied usable labels for 449 of them across 49 tracks, including three
tracks marked instrumental by the lyrics provider. Of those labelled phrases, 343 were voiced and 106
unvoiced.

We ran three pretrained detectors over short audio windows and compared their phrase scores on the same
labelled set. ROC AUC measures how well a score ranks voiced phrases above unvoiced ones, before choosing
a threshold:

| Model | ROC AUC | Mean model CPU per track |
| --- | ---: | ---: |
| PANNs CNN14 (AudioSet) | 0.872 | 110.5 s |
| YAMNet (AudioSet) | 0.860 | 3.5 s |
| Essentia voice/instrumental (Discogs-EffNet) | 0.735 | 12.5 s |

The times count process CPU across all threads. They exclude decoding and are specific to this comparison
run, rather than elapsed playback or production latency. PANNs ranked the phrases a little better, at
roughly 32 times YAMNet's CPU cost. For a library backfill, that was a substantial cost for a small gain on
this sample. [Comparison measurements and calibration notes](/blog/lyrics-as-labels/voice-calibration-2026-11.md).

Essentia's classifier labelled most phrases as voiced. Its
[model card](https://essentia.upf.edu/models/classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1.json)
describes training on 1,000 track excerpts labelled voice or instrumental. Our task needed the location of
voice inside a track. In this test, the classifier recognised only 29% of the phrases with an unvoiced
reference label at the selected thresholds.

We checked how much the lyric rule affected the comparison. Capping lines at four or eight seconds,
or requiring 10% or 50% phrase coverage, moved the AUCs but kept the model ordering. We chose YAMNet.

## Getting YAMNet into the analysis worker

The comparison used Essentia's packaged YAMNet graph. For the worker, we used Google's original weights
and ported the model to PyTorch, which the image already carried. The port reproduces the log-mel front end,
the periodic Hann window and TensorFlow's asymmetric padding. Tests compare the front end with a saved
TensorFlow reference; a separate test compares network outputs when the converted weights are available.
[Port and reference tests](https://github.com/thecrateapp/crate/blob/98d889ac20d48fbec10028d316a848fa729f2c7f/app/tests/test_smart_mix_voice_model.py#L29-L97).

[YAMNet](https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/README.md) returns scores for
521 AudioSet classes. Each patch covers 0.975 seconds of waveform and advances by 0.48 seconds. Crate takes
the highest score among its selected voice classes, including speech, singing, choir, chant and rapping.
The classes use separate sigmoid outputs: a voice score does not have to compete with music for a share of
one total probability.

The analysis worker adds those scores after either the Rust analyser or the Python fallback has produced
the phrases. A missing model or failed inference leaves voice data absent and logs a warning. Missing voice data
remains unknown. Tracks without phrases skip the voice step entirely.

## Keeping a score we could recalibrate

YAMNet often gave voice classes small scores over music. A linear byte scale would have crushed much of
the useful range near zero. We mapped scores logarithmically: values at or below `0.0001` become 0, and a
score of 1 becomes 255. These endpoints describe the model score, not certainty about the audio:

```python source="app/crate/smart_mix/vocals.py#L123-L127" commit="98d889ac20d48fbec10028d316a848fa729f2c7f" "np.log10"
def _log_levels(scores) -> np.ndarray:
    """Scores from ``LOG_FLOOR`` or less (0) to 1 (1) on a log scale."""
    logs = np.log10(np.maximum(np.asarray(scores, dtype=np.float64), LOG_FLOOR))
    floor = np.log10(LOG_FLOOR)
    return np.clip((logs - floor) / -floor, 0.0, 1.0)
```

For a phrase, we use the windows whose centres fall within its time span. Averaging their log scores is
equivalent to taking a geometric mean of the floored scores, then mapping that mean to a byte. A brief
high score therefore contributes less than sustained scores across the phrase.

The first development version stored the fraction of windows above a fixed score. That baked a window
threshold into the data: changing it meant running the model again. With the log score stored instead,
the server can change the phrase threshold when reading the profile.

## Choosing the cut on a broader library

![Synced lyrics supply proxy phrase labels, while YAMNet supplies log-scale phrase scores. Comparing the two lets us choose a threshold without retraining the detector.](/blog/lyrics-as-labels/voice-calibration.svg)

[View the diagram at full size](/blog/lyrics-as-labels/voice-calibration.svg).

We next sampled 358 production tracks with synced lyrics across 20 genres, taking at most one track per
album. After duration checks, phrase availability and the lyric-label rule, 275 tracks contributed 2,721
labelled phrases. There were 2,080 voiced labels and 641 unvoiced ones. The analyser found no phrases on
66 of the original tracks, so the evaluation says nothing about voice detection on those tracks.

That imbalance mattered. Choosing a threshold by F1 favoured calling most phrases voiced. The
cross-validation split by track, keeping all phrases of a track in the same fold. For the log score,
the selected cuts ranged from 55 to 63; fitting all labels selected 55. In the full-set sweep, that cut
recognised only 30% of the unvoiced labels. A voice detector that marks nearly every phrase removes much
of the distinction we wanted the planner to use.

We chose 90, trading some recall for more usable unvoiced passages:

```python source="app/crate/smart_mix/models.py#L47-L49" commit="98d889ac20d48fbec10028d316a848fa729f2c7f" "VOCAL_THRESHOLD = 90"
# Gate SG1b (2026-11-05): a phrase has voice from this byte, a geometric mean voice score
# of about 0.0026. Against synced lyrics: precision 0.88, recall 0.78, specificity 0.66.
VOCAL_THRESHOLD = 90
```

| Cut on the phrase byte | Precision | Recall | Specificity |
| --- | ---: | ---: | ---: |
| 55 | 0.82 | 0.96 | 0.30 |
| 90 | 0.88 | 0.78 | 0.66 |

These are measurements on the full calibration set used to choose the cut, not an independent test of
the final choice. At 90, 88% of the phrases called voiced agreed with a voiced lyric label, 78% of the voiced
labels were found, and 66% of the unvoiced labels stayed unvoiced.

The two kinds of error have different consequences. Missing a voiced phrase can leave a vocal overlap
unpenalised. Marking an instrumental phrase voiced can make a useful transition look worse. The threshold
controls that tradeoff; it cannot eliminate both errors.

Genre results varied substantially. New wave and post-punk had AUCs of 0.94 and 0.92, while industrial metal,
trip-hop and black metal ranged from 0.64 to 0.66. The apparent perfect separation in pop came from just
62 phrases, only four of them unvoiced. It was too small a negative sample to treat as a dependable result.

## Changing the phrases without running the model again

A stored phrase score still depends on where the phrase starts and ends. Improving the segmentation would
make it obsolete. We kept the window scores too, one byte every 0.48 seconds, and rebuilt each phrase score
from the windows inside its new boundaries:

```python source="app/crate/smart_mix/vocals.py#L114-L120" commit="98d889ac20d48fbec10028d316a848fa729f2c7f" "inside = levels"
    levels = np.frombuffer(windows.scores, dtype=np.uint8).astype(np.float64)
    centres = np.arange(levels.size, dtype=np.int64) * windows.hop_ms + PATCH_CENTRE_MS
    presence = bytearray()
    for start_ms, end_ms in spans_ms:
        inside = levels[(centres >= start_ms) & (centres < end_ms)]
        presence.append(round(float(inside.mean())) if inside.size else 0)
    return bytes(presence)
```

Both fresh analysis and reuse of stored windows go through this aggregation, so they produce the same
phrase bytes. Windows are reused only while the file revision and detector version match. Moving the
threshold needs no inference; moving phrase boundaries needs no inference either when those windows
are still valid.

Rounding each window before averaging can move a phrase byte by one compared with averaging the original
float scores. We checked the effect on the same 2,721 phrases at cut 90: precision went from 0.8825 to
0.8824, recall from 0.7837 to 0.7832, and one phrase changed sides. The saved bytes retained the calibration
closely enough for this implementation.

## What changed for Crate

We started with a disabled heuristic that missed obvious singing. Smart Mix 3 gained an optional voice
score per phrase, a calibrated server-side cut and reusable model output. The expensive step moved into
background analysis; the score stayed available to the profile API and subsequent transition planning.

The reference still comes from lyrics. A model can disagree with a lyric label because it heard a backing
vocal the lyrics omitted, or because it made a mistake. These measurements cannot distinguish the two.
They also do not measure how often a listener hears two singers clash in a finished mix. Manually reviewed
phrases and listening tests remain useful checks, especially for genres where the scores separated poorly.

The implementation and its failure behaviour are documented in
[voice per phrase](https://github.com/thecrateapp/crate/blob/98d889ac20d48fbec10028d316a848fa729f2c7f/docs/technical/smart-mix-operations.md#voice-per-phrase).
The analysis of [bar boundaries](/blog/finding-the-one) addresses a separate dependency: a voice score can
only be assigned to a useful phrase if the analyser puts that phrase in the right place.
