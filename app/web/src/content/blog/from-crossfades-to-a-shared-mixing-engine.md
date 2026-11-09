---
title: "From crossfades to a shared mixing engine"
description: "Android's fades could stall while the music kept playing. We moved gain curves into PCM, then gave both decks one output timeline."
date: 2026-11-10
visuals: [crossfade]
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 19
related: [smart-mix-planned-on-the-server, teaching-crate-to-listen, a-beat-grid-in-a-few-bytes]
tags: [How to dismantle Spotify, Smart Mix, Android, audio, history]
sources:
  - app/crate/smart_mix/analyzer.py
  - app/crate/smart_mix/planner.py
  - app/crate/db/jobs/analysis_storage.py
  - app/listen/src/contexts/player-engine-adapter.ts
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeQueueState.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixAudioProcessor.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/PcmBusMixer.java
  - docs/technical/smart-mix-implementation-plan.md
  - docs/technical/smart-mix-operations.md
---

_Part 19. From browser crossfades in April to the shared Android audio bus in October 2026._

An early Android crossfade could leave both decks at their last volume settings while the music
kept playing. Our controller changed deck volume every twenty milliseconds on the main thread.
When that thread was busy, the samples continued but the next gain update had to wait. Once the
callback ran again, it requested the gain for a later point in the transition.

The server could already return a transition plan with cues, duration and gains. Even a correct
plan could suffer from that delay. The incoming track also jumped back to its normal playback
level at the end because we had held its staging gain constant throughout the overlap.
[The envelope failure](https://github.com/thecrateapp/crate/commit/e08714d4a7b51ecdcf72fe196f6730d567c7a22f).

We moved the complete fade envelopes into the audio processors. Later, beatmatching exposed a
different limit: each deck could produce a smooth fade and still start at the wrong point relative to the
other. Fixing that meant giving both decks one PCM output timeline.

The figure below plays the same six-second transition three ways. With **UI timer**, both gains
freeze while the main thread is busy, and the incoming track jumps about 3 dB at the end. With **PCM
envelope**, the same stall no longer touches the fade. With **Shared bus**, the incoming deck starts
on a planned frame, so its beats line up with the outgoing deck's.

<div data-blog-visual="crossfade"></div>

The six-second fade, the stall, the 3 dB staging and the incoming deck's start offset are
illustrative. The curves use the gain formulas from the Android code before and after the
envelope change. The figure does not play audio or reproduce a device measurement; buffering and
Android's output path still separate produced samples from what reaches the listener.

## A volume update every twenty milliseconds

The Android controller calculated progress from elapsed time, so a delayed callback could still
work out how far through the fade it should be. Applying that progress required the callback to
run:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L1560-L1569" commit="c0cf2bb22cd90e138698e28149955c3803cef6bd" "SystemClock.elapsedRealtime()" "mixController.applyProgress(progress)"
    private void evaluateNativeMix() {
        if (player == null || mixController == null) return;
        long nowElapsedMs = SystemClock.elapsedRealtime();
        if (activeTransitionPlan != null) {
            float progress = NativeMixTiming.progress(
                nowElapsedMs,
                transitionStartedElapsedMs,
                activeTransitionPlan.durationMs
            );
            mixController.applyProgress(progress);
```

During a transition, the service scheduled that work with a twenty-millisecond delay on
`mainHandler`.
[Timer scheduling](https://github.com/thecrateapp/crate/blob/c0cf2bb22cd90e138698e28149955c3803cef6bd/app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java#L1548-L1552),
[elapsed-time progress](https://github.com/thecrateapp/crate/blob/c0cf2bb22cd90e138698e28149955c3803cef6bd/app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixTiming.java#L6-L17).

The audio processor already smoothed each requested gain over about ten milliseconds. After a
stall, that short ramp had to cover the change the controller had missed. Smoothing the target
prevented an instantaneous volume step, but it could not recover the intended curve over the
audio that had already passed.
[The original gain ramp](https://github.com/thecrateapp/crate/blob/c0cf2bb22cd90e138698e28149955c3803cef6bd/app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixAudioProcessor.java#L38-L43).

We gave each deck's processor the complete fade as an immutable envelope. The processor adopted
it when processing a buffer and advanced the curve once per PCM frame. A stereo frame contains
one sample for each channel, so both channels receive the same gain. At 48 kHz, a six-second fade
spans 288,000 frames regardless of how often the interface redraws.

Web Audio already provides this kind of separation through scheduled `AudioParam` automation:
a control call supplies a curve or ramp, and audio rendering evaluates it against the context's
time. Our stalled fade came from the Android controller's repeated volume updates. It was not
an inherent limitation of browser audio.
[Web Audio's parameter automation](https://www.w3.org/TR/2021/REC-webaudio-20210617/#AudioParam).

The new processor combined the equal-power curve with staging gain. The underlying outgoing
curve is `cos(progress × π / 2)` and the incoming curve is `sin(progress × π / 2)`. Halfway through,
both gains are about 0.707. Their squared gains sum to one; perceived loudness still depends on
the recordings being mixed.

Staging gain adjusts the level for the particular pair. Holding that adjustment until the last
frame had caused the incoming track's jump back to its normal volume. We eased staging in for
the outgoing track and out for the incoming track, while the equal-power curves continued across
the full overlap:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixAudioProcessor.java#L212-L224" commit="e08714d4a7b51ecdcf72fe196f6730d567c7a22f" "envelopeFrame++" "equalPowerIncoming"
    private float envelopeFactorForNextFrame() {
        if (activeEnvelope == NO_ENVELOPE) {
            return 1.0f;
        }
        float progress = Math.min(1.0f, envelopeFrame / (float) envelopeFrames);
        if (envelopeFrame < envelopeFrames) {
            envelopeFrame++;
        }
        envelopeFactor = activeEnvelope.role == Role.OUTGOING
            ? equalPowerOutgoing(progress) * staging(activeEnvelope.stagingGain, easeIn(progress))
            : equalPowerIncoming(progress) * staging(activeEnvelope.stagingGain, easeOut(progress));
        return envelopeFactor;
    }
```

The envelope tests checked boundary gains and cancellation as well as the shape of the fade.
Cancellation folded the current envelope level into the gain ramp instead of restarting from
full volume. These details affected ordinary pause, seek and skip behaviour, not just the happy
path where both tracks played to the end of a transition.
[Audio-envelope implementation and tests](https://github.com/thecrateapp/crate/commit/e08714d4a7b51ecdcf72fe196f6730d567c7a22f).

Each deck's gain now followed its processed audio. Their buffering and start timing remained
independent, so we could fix the stalled curve and still miss the intended beat. The plan also
specified cue positions and tempo changes, requirements that went well beyond Listen's original
crossfade setting.

## The browser started with a duration

In April, Listen integrated Gapless-5 for browser playback. The wrapper passed the configured
crossfade duration and selected an equal-power curve, then updated the duration when the preference
changed. Gapless-5 supplied the playback machinery; its public interface exposes duration and
curve settings alongside HTML5 and Web Audio playback.
[Crate's first integration](https://github.com/thecrateapp/crate/blob/0c0c2fc401965af28eecd866f032178c921ce8a6/app/listen/src/lib/gapless-player.ts),
[Gapless-5's documented controls](https://github.com/regosen/Gapless-5#4-usage).

That was enough to overlap adjacent tracks. It did not tell us where a useful musical overlap
began. A six-second fade could cross a vocal entrance, miss the beat or mix the quiet tail of one
recording into the loud opening of another. Reducing a gap between files and choosing a transition
between pieces of music required different information.

Crate's general analysis already stored useful track-level features. Bliss supplied a vector for
acoustic similarity. Neither was a temporal description of the beginning and end of a recording.
For mixing, we needed cues and beat positions, plus measurements near the two places we intended
to overlap.

## Give the server a profile it can reuse

The first Smart Mix analyser built a profile from the audio in July. It detected beats with librosa,
derived tempo confidence and stability, estimated key, and found intro and outro cues. It also
measured short windows around those cues. A Rust implementation joined the Python path, and workers
persisted versioned profiles so a pair could be planned without decoding both tracks again.
[Initial Python profile analysis](https://github.com/thecrateapp/crate/blob/c156ff5f6d37ae60dda557257bd628738de1be36/app/crate/smart_mix/analyzer.py#L45-L143),
[Rust profile implementation](https://github.com/thecrateapp/crate/commit/c12849a1c9643617f7e5de670f0ccb9d45c63a79),
[worker integration](https://github.com/thecrateapp/crate/commit/db9a6ab5b3e2b4ed5571172a0f434ee58df7ece1).

The planner then worked from two profiles and a playback context. The context mattered before
musical compatibility did: automatic album playback stayed gapless, while a manual skip used a
short ramp. Missing profiles produced a fallback rather than an analysis request in the playback
path. With usable profiles, the planner could select an adaptive fade or a beatmatched transition
and return a reason when beatmatching was unsuitable.
[First deterministic planner](https://github.com/thecrateapp/crate/blob/24a1ad098a5784d9bc0600c9cf7c85064d3c5619/app/crate/smart_mix/planner.py#L92-L190).

We could now test a pair independently of a phone: the same profiles and context should produce
the same plan. That did not make the measurements correct, but it separated errors in the analysis
from errors in planning and execution. The [technical article on server-planned
transitions](/blog/smart-mix-planned-on-the-server) follows the planner's thresholds and Android's
execution in detail. Here, the important change was that the client consumed a named, versioned
decision rather than deriving the entire transition from its crossfade setting.

![Background analysis stores versioned profiles for the audio source. The server plans a pair from those profiles and the playback context. Android loads its queue independently, then accepts plans only for that queue revision. A running transition keeps its own plan while the audio processor executes it.](/blog/from-crossfades-to-a-shared-mixing-engine/profile-to-execution.svg)

## A stored number needs a meaning and a source

Persistence exposed two mistakes that a plausible-looking profile could hide.

First, the initial analyser labelled the RMS level of a mono downmix as `lufs`, and its largest
sample as `true_peak_dbfs`. Those were not the loudness and true-peak measurements the names
promised. Averaging channels could also hide energy when opposite-phase channels cancelled.
The planner was making gain decisions from values with the wrong semantics.
[Initial measurement code](https://github.com/thecrateapp/crate/blob/c156ff5f6d37ae60dda557257bd628738de1be36/app/crate/smart_mix/analyzer.py#L323-L358).

We replaced those values in the Rust analyser with measurements from an EBU R128 meter fed the
original channels during decoding. The profile recorded a measurement version. The Python fallback
at that stage returned null for loudness and peak instead of substituting RMS. The analyser version
also changed so existing profiles would be recomputed.
[The measurement correction](https://github.com/thecrateapp/crate/commit/63b43a6b5066217474fea3059d04d01aaeed1c36).

ITU-R BS.1770 defines algorithms for programme loudness and true-peak level. Using an established
meter gave those profile fields a specific measurement contract. It still left decisions for our
planner: which windows to compare, how much gain to allow and what to do when a measurement was
absent.
[ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en).

The second mistake concerned the file behind the result. We originally calculated its source
revision when storing the profile, after analysis. If the file changed while a worker was running,
the old audio's measurements could be labelled with the replacement file's revision. A late worker
could also overwrite a newer profile.

We moved source capture before analysis, recording file size, nanosecond modification time and
inode, together with the current profile revision and the worker's claim token. Publication checked
the source again before accepting the draft:

```python source="app/crate/db/jobs/analysis_storage.py#L502-L511" commit="787a619ae5dc30ff5e42785f3f5a87e4cabdb9c1" "SmartMixPublication.SOURCE_CHANGED"
def publish_smart_mix_profile(
    capture: SmartMixCapture,
    draft: TrackMixProfileDraft,
) -> SmartMixPublication:
    if smart_mix_source_revision(capture.path) != capture.source_revision:
        with transaction_scope() as session:
            _release_smart_mix_claim(session, capture)
        return SmartMixPublication.SOURCE_CHANGED
    with transaction_scope() as session:
        return _publish_smart_mix_profile(session, capture, draft)
```

Inside the transaction, publication also checked the track path, claim ownership and expected
profile revision. A superseded worker could finish its computation without replacing the newer
result. For the same source and analyser generation, a fuller profile could promote a partial one;
the original shared idempotency key had allowed a partial Python result to block that promotion.
[Publication and promotion rules](https://github.com/thecrateapp/crate/blob/787a619ae5dc30ff5e42785f3f5a87e4cabdb9c1/app/crate/db/jobs/analysis_storage.py#L523-L587),
[concurrent publication regressions](https://github.com/thecrateapp/crate/blob/787a619ae5dc30ff5e42785f3f5a87e4cabdb9c1/app/tests/test_smart_mix_publication.py).

The file revision was based on filesystem metadata, not a hash of every audio byte. It detected
the changes represented by that metadata; it was not proof that two files sounded identical.
Profile revision, analyser generation and measurement version each answered a separate question,
and the plan cache needed to respect those distinctions.

## Better planning must not make Play slower

The first Android integration waited for transition plans while starting a queue. There was no
deadline, and an offline device still tried the request. We initially bounded the request to one
second and skipped it offline, but that still made playback startup wait for an optional plan.
[Bounding the request](https://github.com/thecrateapp/crate/commit/53d286083a54b3d6266504e307f56bfcce30cfe0).

We separated queue loading from plan installation. Listen could load the native queue without
awaiting the plan request, then attach its result later. That introduced a familiar asynchronous problem:
the listener might replace the queue before the response arrived.

The native queue accepted the update only when its revision still matched:

```java source="app/listen/android/app/src/main/java/app/cratemusic/crate/NativeQueueState.java#L56-L72" commit="beebff6a2ffc50ec240639d0356e8d798828d7a9" "!revision.equals(requestedRevision)"
    boolean replaceTransitionPlans(
        String requestedRevision,
        List<NativeTransitionPlan> replacementPlans
    ) {
        if (
            requestedRevision == null ||
            requestedRevision.isEmpty() ||
            !revision.equals(requestedRevision)
        ) {
            return false;
        }
        transitionPlans.clear();
        if (replacementPlans != null) {
            transitionPlans.addAll(replacementPlans);
        }
        return true;
    }
```

The TypeScript adapter checked the revision too. A running transition retained its own plan, so
replacing plans for future pairs could not alter a fade already in progress. Tests exercised a
stale response arriving after a new queue and verified that only the current queue's plans reached
the native service.
[Asynchronous plan installation](https://github.com/thecrateapp/crate/commit/beebff6a2ffc50ec240639d0356e8d798828d7a9).

Listen could now start the queue while the server worked on its transitions. The native service
also learned to request upcoming plans while the WebView was suspended. Otherwise, the next batch
of decisions would still depend on JavaScript waking up, even though native code could execute
the current fade.
[Native background planning](https://github.com/thecrateapp/crate/commit/66adfe57909c61bf9d8cb4c0f3b926cdab866ece).

## Two decks needed one output clock

Earlier native crossfades parsed the plan's tempo and phase fields without executing them.
When we started using those fields for beatmatching, a smooth envelope on each deck was no
longer enough. The incoming cue had to meet the outgoing cue at the intended beat.
[Executing the plan's tempo and phase](https://github.com/thecrateapp/crate/commit/f02fed17bbe843b69d0e3d83aad1ba27cd866a5a).

The first beatmatch executor used muted preroll and corrections based on each player's reported
position. With two Media3 outputs, that estimate did not reliably align the incoming cue. Start
jitter and load stalls could consume the preroll before the deck caught up. Most attempts in the
initial device run fell back to an adaptive fade.
[Dual-output findings and the bus experiment](https://github.com/thecrateapp/crate/commit/5c21c6471d6f59013c3bf2bb7107a56a196a8837).

We kept the Media3 decks for loading and decoding, but changed where their audio went. Each deck
wrote PCM into a ring buffer. A common mixer consumed both decks at 48 kHz and wrote the sum to
one `AudioTrack`. Android's `AudioTrack` streaming interface accepts PCM buffers supplied by the
application, which let us control the relative placement of both decks before handing the mixed
output to the system.
[Shared-bus implementation](https://github.com/thecrateapp/crate/commit/2560c27b35421acac978e983e21afb2d81de84e5),
[AudioTrack's streaming interface](https://developer.android.com/reference/android/media/AudioTrack).

The incoming channel could now remain held until a specific frame on that bus. The controller
estimated where the incoming cue should meet the outgoing cue, and the mixer started consuming
the held channel at that frame. If the scheduled start was already in the past, it discarded
available incoming frames for the missed interval. That gave both streams a common output
position without repeatedly changing playback speed during the audible overlap to chase start
jitter. It still needed enough decoded audio in the ring; choosing a frame could not make
missing samples arrive.
[Starting on a bus frame](https://github.com/thecrateapp/crate/commit/0de50a8b5ff70750b969677434cba4030bacb6fa).

![The earlier Android design had two Media3 decks feeding separate outputs. The replacement keeps two decoding decks but writes each into a PCM ring. A shared mixer schedules their relative frames and sends a single mixed stream to AudioTrack. Android's system mixer and hardware remain downstream of that controlled boundary.](/blog/from-crossfades-to-a-shared-mixing-engine/one-output-clock.svg)

[Open the audio-output diagram at full size](/blog/from-crossfades-to-a-shared-mixing-engine/one-output-clock.svg).

The bus frame counter tracks the mixed PCM blocks the application produces. `AudioTrack` and
the device keep their own buffers and playback position downstream. A plan's cue time, a decoded
frame in a ring and a frame heard through headphones are different positions in that path. The
shared bus lets us place the two streams relative to each other before they leave Crate; it does
not turn a player position estimate into a measurement of physical output.

The bus also gave us a place to capture what the application actually produced. That found errors
the player's position estimates had missed. One drifting-tempo fixture still arrived off beat
because the planner extrapolated a global BPM from an anchor to a cue much later in the track.
We added tempo and fitted beat positions local to each cue, and changed the planner's rules
revision so cached plans could not keep the old calculation.
[Local tempo at the cues](https://github.com/thecrateapp/crate/commit/d36c235cf6e28bb73475710070e4ea4b0eb38df0).

On the Xiaomi 13 debug build and local synthetic fixture playlist, the internal bus capture for
that drifting-tempo pair improved from 25 ms phase error at p95 to 4 ms after the local-tempo
change. That was a result for captured application PCM on those fixtures. It did not measure the
system mixer, hardware output or timing on other phones.
[The captured before-and-after](https://github.com/thecrateapp/crate/blob/7a67426c9c3fdcda62c0ecc76a09f73bca0f86cd/docs/technical/smart-mix-implementation-plan.md).

Even the capture checks needed repair. An early Doze run passed while its recording stopped in
the middle of the mix. We added a continuity check comparing captured frames with elapsed wall
time and invalidated the earlier result. Fixing the lifecycle problem and rerunning the matrix
was necessary before a low phase-error number meant anything.
[The incomplete capture and corrected gate](https://github.com/thecrateapp/crate/commit/7a67426c9c3fdcda62c0ecc76a09f73bca0f86cd).

## What the shared engine changed

The original crossfade setting controlled how long two recordings overlapped. By October, the
system had distinct owners for analysis, pair planning and sample execution. A worker could improve
a profile without making every phone analyse the audio. A server could return a better plan without
blocking Play. The native executor could reject a late plan or downgrade an unsafe transition
while continuing the queue.

The profiles and plan contracts can be reused across consumers; the common PCM output belongs
to Android. In the integration described here, the server-plan branch targets native Android;
web and desktop retain their own crossfade and transition heuristics, and native
iOS parity remains planned. VirtualDJ consumes Crate's data with its own mixing machinery.
[Consumer boundaries](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/smart-mix-operations.md),
[native-only plan integration](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/player-engine-adapter.ts#L255-L320).

Capabilities still gate Smart Mix, native crossfade, beatmatching and bass handoff, with configuration
defaults off and user preferences applied on top. Physical-output checks remain separate from the
internal bus tests.

The original timer could leave a gain unchanged while audio kept moving. The PCM envelope fixed
that within each deck. The shared bus then gave us one place to schedule their relative start,
mix their samples and capture the result. That capture was useful even when it showed the plan
was wrong: it exposed the cue-local tempo error and, once we checked continuity, distinguished a
completed transition from a recording that had simply stopped early.
