---
title: "Planning DJ transitions on the server, playing them on a phone"
description: "A good transition needs beat grids, cues and loudness for both tracks. Crate's server plans each one; the Android app plays it on a single audio clock."
date: 2026-11-10
tags: [Smart Mix, Android, audio, Python]
sources:
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/models.py
  - app/crate/api/smart_mix.py
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixController.java
  - docs/technical/smart-mix-design.md
---

Most music players crossfade blind. A few seconds before a track ends, they turn it down and turn the next one up,
whatever is playing. If the beats don't line up you get a stumble, and if the next track is quieter it sounds like
something broke.

A DJ does three things a timer can't. They pick where each track should be when the mix starts, usually the end
of one phrase and the start of the next. They match the tempo so the beats land together. And they swap the bass
lines so two kick drums never pile up. All of that depends on knowing the music: where every beat is, where the
intro and outro sit, and how loud each track is.

That knowledge is expensive to get. A phone could decode two whole tracks and analyse them before every
transition, but that's a lot of battery for a few seconds of music. What the phone does have is a precise audio
clock. So Crate splits the job: the server knows the music, the phone keeps time.

## Analyse once, plan per pair

Every track gets a mix profile when it's analysed on the server: tempo and its stability, the beat grid, key,
intro and outro cues, and loudness at both ends measured with BS.1770. The Rust analysis tool does most of this
work, with a Python fallback, on the worker queue reserved for heavy jobs. It happens once per track.

When Listen knows what's coming next in the queue, it asks the server how to get from one track to the other:
`POST /api/playback/transition-plans`, with up to 32 pairs per request. The answer for each pair is a transition
plan. Plans are cached for six hours in Redis, keyed by both tracks' profile revisions and the playback context, so
re-planning the same pair is a lookup.

![The server turns two mix profiles into a transition plan; the phone plays both decks on one clock, fading one out, the other in, and swapping the bass halfway.](/blog/smart-mix-planned-on-the-server/plan-to-mix.svg)

## What the planner decides

The planner goes through its options in order. An album played in order stays gapless. A manual skip gets a quick
350 ms ramp. If either track has no profile yet, it falls back to a plain three-second fade and says why. Only
then does it try to beatmatch.

Beatmatching has to earn its place. Both tracks need a BPM confidence of at least 0.75, a tempo stability of at
least 0.80 and the same meter, and the window has to hold at least eight beats. The tempo change can't be bigger
than 4%:

```python source="app/crate/smart_mix/planner.py#L307-L316" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "INCOMPATIBLE_TEMPO"
adjustment = abs(_cue_tempo_ratio(outgoing, incoming) - 1.0)
maximum_adjustment = min(
    policy.maximum_tempo_adjustment,
    policy.hard_maximum_tempo_adjustment,
)
if adjustment > maximum_adjustment:
    return TransitionFallbackReason.INCOMPATIBLE_TEMPO
if not context.allow_tempo_adjustment and adjustment > 0.001:
    return TransitionFallbackReason.INCOMPATIBLE_TEMPO
return None
```

When a check fails, the planner downgrades to an adaptive crossfade and records the reason
(`unstable_tempo`, `incompatible_tempo`, `incompatible_meter` and so on), so every downgraded transition says
why.

Normal transitions last between one and twelve seconds. Very stable tracks can get a long blend of 32, 16 or 8
bars, up to 48 seconds. Loudness is levelled by at most 6 dB, and a track is only turned up when both were
measured with the same method. A ceiling based on each track's true peak keeps the sum from clipping.

The plan validates itself before it leaves the server. A tempo ratio outside 0.94 to 1.06, an unknown curve or an
unknown bass mode raises an error:

```python source="app/crate/smart_mix/models.py#L372-L383" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f"
ratio = float(self.incoming_tempo_ratio)
if not math.isfinite(ratio) or ratio < 0.94 or ratio > 1.06:
    raise ValueError("incoming_tempo_ratio must be between 0.94 and 1.06")
object.__setattr__(self, "incoming_tempo_ratio", ratio)
object.__setattr__(
    self, "handoff_progress", _clamp_confidence(self.handoff_progress)
)
object.__setattr__(self, "confidence", _clamp_confidence(self.confidence))
if self.curve not in TRANSITION_CURVES:
    raise ValueError(f"Unsupported transition curve: {self.curve!r}")
if self.bass_handoff not in {"none", "balanced"}:
    raise ValueError(f"Unsupported bass handoff: {self.bass_handoff!r}")
```

## Playing it on one clock

On Android, the two tracks play on two Media3 decks that feed a single `AudioTrack` at 48 kHz. A mixer thread
running at maximum priority sums them in blocks of 480 frames, 10 ms each. Because both decks share that one
clock, the incoming track can start at an exact sample inside a block.

The phone still checks the server's work. Before it commits to a beatmatch it plays a 2.5-second preroll, collects
at least three phase measurements and needs the median phase error to be 10 ms or less. If the beats don't line
up, it plays the incoming track at normal speed and you get a regular crossfade:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixController.java#L264-L277" commit="cacf4b3471371b6cc68c7a3baf2a4a752f74626f" "beatmatch ?"
beatmatchEngaged = beatmatch;
bassHandoffEngaged = beatmatch && plan.hasBassHandoff();
beatmatchSpeed = beatmatch ? plan.incomingTempoRatio : 1.0f;
float bassHandoffAt = bassHandoffEngaged
    ? plan.handoffProgress
    : Float.NaN;
boolean djBlend = beatmatch && plan.isDjBlend();
mixOutgoingDeck.startEnvelope(
    NativeMixAudioProcessor.Role.OUTGOING,
    plan.durationMs,
    plan.outgoingGainDb,
    bassHandoffAt,
    djBlend
);
```

The bass swap only happens on a real beatmatch. Each deck gets a 150 Hz shelf that cuts the low end by 24 dB, and
the two shelves trade places over an eighth of the transition, centred at the halfway point. The phone only
applies gains downwards, so a deck stays at or below its original level.

If the plan doesn't arrive in time, Listen gives up waiting with five seconds to spare (never waiting less than
one second or more than ten) and plays a safe equal-power crossfade. A plan that arrives late is shortened to fit,
or dropped if too little time is left.

## What it cost, and what's still open

Smart Mix plays only in the Android app today. The web and desktop apps share the planning code but don't run the
mixer, and iOS is an open item. The VirtualDJ plugin uses the same profiles with VirtualDJ's own automix. Every
feature flag is off by default, and they unlock in order: Smart Mix, native crossfade, beatmatch, then bass swap.

Several targets are written down but not measured yet. Plans should come back in under 50 ms at p95 from cache and
150 ms without it. Beatmatched phase error should stay under 20 ms at p95, and there's a pending check for
clipping and buffer underruns on real devices. Until those numbers exist, the 10 ms preroll check is the
safeguard against a mix that drifts out of phase.

## Read the code

The planner is `app/crate/smart_mix/planner.py`, with the plan contract in `models.py` and the API in
`app/crate/api/smart_mix.py`. On Android, start at `NativeMixController.java`.
