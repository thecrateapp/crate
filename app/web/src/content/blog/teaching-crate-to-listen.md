---
title: "Teaching Crate to listen to its own library"
description: "Crate could identify a recording before it could describe its sound. We added audio features and Bliss, then fixed what our models and Rust integration missed."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 7
related: [building-an-artist-page-when-the-providers-disagree, finding-the-one, lyrics-as-labels, smart-mix-planned-on-the-server]
tags: [How to dismantle Spotify, audio analysis, Rust, recommendations, history]
sources:
  - docs/technical/06-audio-analysis-similarity-and-discovery.md
  - app/crate/audio_analysis.py
  - app/crate/bliss.py
  - app/crate/crate_cli.py
  - tools/crate-cli
---

_Part 7. Adding audio analysis and similarity, March 2026._

Our first mood analyser could raise both `happy` and `aggressive` for the same reason: a recording
was loud and bright. We had given a few signal measurements more descriptive power than they deserved.

Crate already knew how to identify albums and read their tags. The
[indexed catalogue](/blog/filesystem-to-indexed-catalogue) could answer which tracks belonged to an
artist, where their files lived and how long they ran. Choosing music by how it sounded needed other
information. A genre attached to an artist would not tell us which of their tracks had a quiet
opening, a strong pulse or mostly instrumental passages.

We started extracting features from the audio itself. That work produced two useful outputs: named
measurements we could display and filter, and a compact representation we could compare with other
tracks. Getting there involved a classifier we switched off, a separate Rust executable and a
replacement analyser that initially returned fewer fields than the code it replaced.

## A mood score made from the wrong ingredients

The first implementation loaded up to 120 seconds of a track as mono audio at 22,050 Hz. Librosa
estimated its tempo; a chroma representation, averaged over time, was compared with major and minor
key profiles. Mean RMS amplitude supplied an energy value. Each operation filled a field in a result
dictionary, leaving `None` when it could not produce a result.
[Initial feature extraction](https://github.com/thecrateapp/crate/blob/f16d37900d03b315c6df3f5a25dfe128ad2d47e6/app/musicdock/audio_analysis.py#L26-L102).

The mood function combined those measurements with spectral centroid, rolloff and zero-crossing rate:

```python source="app/musicdock/audio_analysis.py#L127-L137" commit="f16d37900d03b315c6df3f5a25dfe128ad2d47e6" "happy" "aggressive"
    # Heuristic mood scoring
    moods = {
        "happy": round(min(1.0, (tempo_norm * 0.4 + centroid_norm * 0.3 + energy_norm * 0.3)), 3),
        "sad": round(min(1.0, ((1 - tempo_norm) * 0.4 + (1 - energy_norm) * 0.3 + (1 - centroid_norm) * 0.3)), 3),
        "aggressive": round(min(1.0, (energy_norm * 0.4 + zcr_norm * 0.3 + centroid_norm * 0.3)), 3),
        "relaxed": round(min(1.0, ((1 - energy_norm) * 0.4 + (1 - zcr_norm) * 0.3 + (1 - tempo_norm) * 0.3)), 3),
        "electronic": round(min(1.0, (rolloff_norm * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3)), 3),
        "acoustic": round(min(1.0, ((1 - rolloff_norm) * 0.3 + (1 - centroid_norm) * 0.3 + zcr_norm * 0.4)), 3),
        "party": round(min(1.0, (tempo_norm * 0.5 + energy_norm * 0.3 + centroid_norm * 0.2)), 3),
        "dark": round(min(1.0, ((1 - centroid_norm) * 0.4 + energy_norm * 0.3 + (1 - tempo_norm) * 0.3)), 3),
    }
```

The overlap is visible in the arithmetic. Increasing energy and centroid increases both `happy`
and `aggressive`. Those emotions can coexist in music, but the function had no evidence of either:
it was assigning emotional names to combinations of amplitude, frequency and tempo. The three
decimal places made the result look more precise than the interpretation behind it.

Even the measurements had a scope. A two-minute prefix says little about a track that changes after
its opening section. RMS amplitude depends on the recording level as well as the performance. The
analyser could return a number for a file without having measured everything a listener would mean
by that number.

We kept analysis outside browsing requests. A worker selected tracks for an artist or album, called
the analyser and stored the results in the catalogue. The first handler used the presence of BPM as
its completion test: it skipped tracks that already had BPM and saved a result only when BPM was
available. Other fields could still be empty. That was enough to get values onto album pages, but
it coupled the completeness of all analysis to one feature.
[Worker selection and persistence](https://github.com/thecrateapp/crate/blob/f16d37900d03b315c6df3f5a25dfe128ad2d47e6/app/musicdock/worker.py#L529-L589).

## Choosing what to measure, and what to infer

Librosa gave us the individual operations needed for the first implementation. Its spectral
centroid, for example, is a weighted mean of frequencies for each frame. It returns frequencies,
not a mood or a score between zero and one. Turning that output into a brightness indicator already
requires a choice of scale; turning it into happiness adds a much larger assumption.
[Librosa's spectral centroid definition](https://librosa.org/doc/0.11.0/generated/librosa.feature.spectral_centroid.html).

Essentia offered complete music-analysis algorithms behind a Python interface. We added it as the
preferred backend and retained librosa when Essentia was unavailable. The Essentia path used
`RhythmExtractor2013` for tempo and `KeyExtractor` for key and scale. Its rhythm extractor expects
44,100 Hz input and returns beat positions and confidence as well as BPM. Our integration loaded
audio at that rate and kept the BPM value; the early catalogue did not yet retain a beat grid.
[Essentia's rhythm contract](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html),
[Crate's backend selection and extractor calls](https://github.com/thecrateapp/crate/blob/ee5543bb6450ac9cc2e4c5868189746db6ee7d2a/app/musicdock/audio_analysis.py#L12-L82).

The backends also handled the duration limit differently. Librosa received `duration=120` when
loading. The Essentia path called `MonoLoader` and sliced the returned array afterwards. The slice
limited what the feature algorithms processed; it did not bound the initial decode to two minutes.
That distinction matters when a library contains long recordings.

We also removed repeated feature extraction inside our own Python code. The original mood helper
ran beat tracking again after the main function had already estimated BPM. A later pass computed
RMS, chroma and the spectral features once and reused them across the derived scores.
[Shared feature calculations](https://github.com/thecrateapp/crate/blob/826c5bdc5fc548e7499a7ba409d60bb40b00d694/app/musicdock/audio_analysis.py#L15-L57).

None of that supplied the missing emotional labels. For those, a trained classifier was another
approach. Essentia provides pretrained embeddings and separate classification heads, including
models for mood and danceability. The distinction is useful: the embedding supplies a representation
of the audio; a head maps that representation to the labels it was trained to predict.
[Essentia's model catalogue](https://essentia.upf.edu/models.html).

### The classifier we switched off

We integrated Essentia's Discogs EffNet embeddings and classification heads, then averaged their
predictions into track-level values. An early result for Blood Incantation came back with
`happy=0.99`, `acoustic=0.95` and `aggressive=0.016`. We disabled that path and returned the Essentia
backend to our revised heuristics, leaving the model code in place.
[Classifier integration](https://github.com/thecrateapp/crate/blob/f6210353f85fe7551dbd0e0de43ceae7accbe324/app/musicdock/audio_analysis.py#L119-L208),
[the result and rollback](https://github.com/thecrateapp/crate/commit/1659f277409bceca966eac92f6b25db6a684ed3a).

That result did not establish that the models were generally unsuitable for music analysis. It
showed that our integration was producing descriptors we could not use confidently. A full diagnosis
would have needed to check the input, output class ordering, aggregation and a labelled sample of
the library. Switching the branch back stopped those predictions becoming our default while that
question remained open.

The next implementation used PANNs CNN14. PANNs predicts sound classes from AudioSet; its inference
API returns clip-level scores. Those classes include instruments and music styles as well as mood
labels. They gave us inputs such as singing, electric guitar and heavy metal that we could inspect
before combining them into Crate's fields.
[PANNs model and inference documentation](https://github.com/qiuqiangkong/audioset_tagging_cnn).

We loaded the CNN14 checkpoint lazily on the CPU and reused the model. The Essentia route supplied
up to 120 seconds for signal analysis and resampled a prefix of up to 30 seconds to 32 kHz for
PANNs. Batch inference grouped four tracks, padded the shorter arrays and applied the resulting
scores back to each track. If PANNs was unavailable, the Essentia route kept its heuristic path.
[Model loading](https://github.com/thecrateapp/crate/blob/36432d7b6899bf99793a2eb3e9097f5bc2dd7a1d/app/musicdock/audio_analysis.py#L87-L110),
[batch preparation and inference](https://github.com/thecrateapp/crate/blob/36432d7b6899bf99793a2eb3e9097f5bc2dd7a1d/app/musicdock/audio_analysis.py#L243-L312).

Crate still had to define how these outputs became product features. We assigned weights to groups
of labels: heavy metal and angry music contributed to high energy; ambient music and lullabies
contributed to low energy. Then we combined those scores with signal measurements:

```python source="app/musicdock/audio_analysis.py#L423-L433" commit="36432d7b6899bf99793a2eb3e9097f5bc2dd7a1d" "energy_panns" "dance_panns"
    # Energy: PANNs genre ratio + signal blend
    e_high = ws("energy_high")
    e_low = ws("energy_low")
    energy_panns = e_high / (e_high + e_low + 0.1)
    result["energy"] = round(max(0.0, min(1.0,
        energy_panns * 0.5 + energy_signal * 0.5)), 3)

    # Danceability: PANNs + signal rhythm
    dance_panns = ws("dance") / 1.2
    result["danceability"] = round(max(0.0, min(1.0,
        dance_panns * 0.4 + dance_signal * 0.6)), 3)
```

`ws()` summed the model scores with our label weights. The 50/50 energy blend and the 40/60
danceability blend were our formulas; PANNs did not provide calibrated Crate energy or danceability
scores. The model supplied more evidence, but we still chose the mapping and inherited its biases. A thirty-second opening could also miss vocals or instruments that arrived later.
[Label groups and weighted sum](https://github.com/thecrateapp/crate/blob/36432d7b6899bf99793a2eb3e9097f5bc2dd7a1d/app/musicdock/audio_analysis.py#L115-L178).

## Comparing tracks without naming their mood

Alongside the named features, we added Bliss to find acoustically similar recordings in
our own library.

Bliss represents an analysed song as a numeric feature vector. Its documented playlist approach
compares those vectors and orders songs by distance. A related project, blissify, applies the
library to MPD. This gave us an existing audio-similarity implementation to integrate.
[Bliss's analysis and playlist model](https://docs.rs/bliss-audio/latest/bliss_audio/).

Our first integration was a small Rust executable called `grooveyard-bliss`. It wrapped the
library's decoder and analysis, returning a path and twenty floating-point features, or an error
for that file:

```rust source="tools/grooveyard-bliss/src/main.rs#L83-L96" commit="9965019bf70a70051961b6ca3fc34daab755fd09" "song.analysis.as_vec()"
fn analyze_file(path: &Path) -> TrackResult {
    match Song::from_path(path) {
        Ok(song) => TrackResult {
            path: path.to_string_lossy().to_string(),
            features: song.analysis.as_vec(),
            error: None,
        },
        Err(e) => TrackResult {
            path: path.to_string_lossy().to_string(),
            features: Vec::new(),
            error: Some(format!("{}", e)),
        },
    }
}
```

The process boundary consisted of arguments and JSON. Python passed a file or directory as command
arguments and parsed JSON from stdout. Rust wrote progress to stderr and used Rayon to analyse
directory entries in parallel. Python owned the task and database writes. The single-file wrapper
had a 60-second timeout; a directory run had an hour. Nonzero exits and parse failures returned no
result to the caller, while batch parsing omitted files with an error.
[Python subprocess wrapper](https://github.com/thecrateapp/crate/blob/9965019bf70a70051961b6ca3fc34daab755fd09/app/musicdock/bliss.py#L33-L76),
[parallel directory analysis](https://github.com/thecrateapp/crate/blob/9965019bf70a70051961b6ca3fc34daab755fd09/tools/grooveyard-bliss/src/main.rs#L109-L125).

The worker stored vectors in `library_tracks.bliss_vector`. Our first database search fetched the
seed vector and used PostgreSQL array arithmetic to sum squared differences, take the square root
and sort by distance. It scanned the stored candidates. The later cosine and vector-index work
had not happened yet; the immediate gain was that a similarity request could reuse audio analysis
instead of decoding the collection again.
[Vector storage and the original distance query](https://github.com/thecrateapp/crate/blob/9965019bf70a70051961b6ca3fc34daab755fd09/app/musicdock/bliss.py#L98-L132).

A nearby vector did not establish that two tracks shared a genre, belonged next to each other in
a queue or would make a smooth transition. It supplied candidates. Repetition, artist diversity
and the direction of a listening session would become work for the radio engine.

![Two background analysis paths read library audio. Feature analysis produces named measurements and inferred traits; Bliss produces comparison vectors. Workers persist both in the catalogue, so display and similarity reads can reuse the results.](/blog/teaching-crate-to-listen/two-analysis-paths.svg)

[Open the analysis diagram at full size](/blog/teaching-crate-to-listen/two-analysis-paths.svg).

## A replacement analyser still has to return the missing fields

We expanded the Rust tool into `crate-cli`, with separate `scan`, `analyze` and `bliss` commands.
The new analyser decoded with Symphonia and computed signal features in Rust. The Python adapter
recognised both the new binary and the earlier Bliss executable; it checked for subcommands before
requesting operations the old binary could not perform.
[CLI commands and compatibility](https://github.com/thecrateapp/crate/blob/ccc85bcc0f8acb588a4fc115362b3e873e9ef39a/app/musicdock/crate_cli.py),
[Rust analyser](https://github.com/thecrateapp/crate/blob/ccc85bcc0f8acb588a4fc115362b3e873e9ef39a/tools/grooveyard-bliss/src/analyze.rs).

The initial integration returned a successful Rust result immediately. That result had BPM, key,
energy and other signal fields, but explicitly set mood, danceability, valence, acousticness and
instrumentalness to `None`. Installing the preferred analyser could therefore remove the richer
features from new analysis results. A process exit code and valid JSON were insufficient to decide
whether the old operation had been replaced.
[Initial Rust result mapping](https://github.com/thecrateapp/crate/blob/c6c7c2db9c0d9b00cdaf0c12a5e16dccaee04574/app/musicdock/audio_analysis.py#L183-L227).

We added a supplement to the single-track path. When none of the checked advanced fields was
present, it ran the available Python backend and merged missing values:

```python source="app/crate/audio_analysis.py#L195-L211" commit="d9ec0f72d3cd6482c28364ce9a05891e20af28e2" "has_advanced" "rust[key] = supplement[key]"
    if rust:
        # Check if advanced metrics are missing — Rust CLI only does signal-level analysis
        has_advanced = any(rust.get(k) is not None for k in ("danceability", "valence", "mood", "acousticness"))
        if not has_advanced:
            _detect_backend()
            supplement = None
            if _BACKEND == "essentia":
                supplement = _analyze_essentia(str(filepath))
            elif _BACKEND == "librosa":
                supplement = _analyze_librosa(str(filepath))
            if supplement:
                # Merge: keep Rust values for basic metrics, add Python values for advanced
                for key in ("danceability", "valence", "acousticness", "instrumentalness",
                            "mood", "spectral_complexity"):
                    if rust.get(key) is None and supplement.get(key) is not None:
                        rust[key] = supplement[key]
        return rust
```

The merge preserved existing Rust values, including its energy measurement. Consequently, a
supplemented Rust result did not become identical to a full Python/PANNs result. Running the Python
backend also meant decoding and calculating some signal features again. We recovered fields at a
cost; moving a function into Rust had not removed the rest of the pipeline.

The condition was narrower than a general completeness check: one non-null advanced field was
enough to skip supplementation. The batch entry point still returned its Rust batch directly.
Those distinctions matter when describing what this fix delivered: it restored missing features
for the single-track route it changed, not parity across every route.
[Batch dispatch at the same revision](https://github.com/thecrateapp/crate/blob/d9ec0f72d3cd6482c28364ce9a05891e20af28e2/app/crate/audio_analysis.py#L229-L238).

We also had to reconcile units. The Rust adapter originally copied `spectral_centroid`, measured
in Hz, into a field called `spectral_complexity` that consumers expected on a zero-to-one scale.
We normalised the centroid with a logarithmic mapping capped at one. That repaired the scale at
the boundary; it did not make centroid and spectral complexity the same measurement.
[Centroid normalisation](https://github.com/thecrateapp/crate/commit/693b822d49ecb650d916bcba1c7c764d39b9e82e).

The CLI tests checked behaviours we could establish with generated audio: a louder sine should
have a higher loudness value, a higher-frequency sine should have a higher centroid, energy should
stay in range, and invalid files should return errors. These were useful checks on the implementation.
They did not establish that a song's mood or key matched a listener's judgement.
[Early analyser tests](https://github.com/thecrateapp/crate/blob/ccc85bcc0f8acb588a4fc115362b3e873e9ef39a/tools/grooveyard-bliss/tests/analyze_tests.rs).

Later, [Smart Mix](/blog/smart-mix-planned-on-the-server) would need information this analyser did
not preserve: where beats and phrases occurred, how confident those positions were and what the
audio did near a transition. A similarity vector can find candidates without preserving the timing needed to mix them.
