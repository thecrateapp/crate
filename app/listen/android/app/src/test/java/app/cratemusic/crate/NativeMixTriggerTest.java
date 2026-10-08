package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NativeMixTriggerTest {
    private static final long TRACK_MS = 180_000L;

    @Test
    public void waitsUntilThePlannedOutgoingCue() {
        NativeMixTrigger.Decision decision = NativeMixTrigger.evaluate(
            true,
            150_000L,
            TRACK_MS,
            plan(165_000L, 12_000L),
            true
        );

        assertEquals(NativeMixTrigger.Action.WAIT, decision.action);
        assertEquals(1_000L, decision.nextCheckDelayMs);
    }

    @Test
    public void startsAtThePlannedCueWithThePlannedDuration() {
        NativeMixTrigger.Decision decision = NativeMixTrigger.evaluate(
            true,
            164_980L,
            TRACK_MS,
            plan(165_000L, 12_000L),
            true
        );

        assertEquals(NativeMixTrigger.Action.START, decision.action);
        assertEquals(12_000L, decision.durationMs);
    }

    @Test
    public void shortensALatePlanToTheRemainingOutgoingAudio() {
        NativeMixTrigger.Decision decision = NativeMixTrigger.evaluate(
            true,
            172_000L,
            TRACK_MS,
            plan(165_000L, 12_000L),
            true
        );

        assertEquals(NativeMixTrigger.Action.START, decision.action);
        assertEquals(TRACK_MS - 172_000L - 50L, decision.durationMs);
    }

    @Test
    public void fallsBackWhenTooLittleOutgoingAudioRemains() {
        NativeMixTrigger.Decision decision = NativeMixTrigger.evaluate(
            true,
            179_400L,
            TRACK_MS,
            plan(165_000L, 12_000L),
            true
        );

        assertEquals(NativeMixTrigger.Action.FALL_BACK, decision.action);
    }

    @Test
    public void keepsOutgoingPlayingWhileTheStandbyIsNotReady() {
        NativeMixTrigger.Decision waiting = NativeMixTrigger.evaluate(
            true,
            165_000L,
            TRACK_MS,
            plan(165_000L, 12_000L),
            false
        );
        NativeMixTrigger.Decision exhausted = NativeMixTrigger.evaluate(
            true,
            179_200L,
            TRACK_MS,
            plan(165_000L, 12_000L),
            false
        );

        assertEquals(NativeMixTrigger.Action.WAIT, waiting.action);
        assertEquals(20L, waiting.nextCheckDelayMs);
        assertEquals(NativeMixTrigger.Action.FALL_BACK, exhausted.action);
    }

    @Test
    public void movesACueThatNoLongerFitsTheDecodedDurationEarlier() {
        NativeMixTrigger.Decision decision = NativeMixTrigger.evaluate(
            true,
            157_900L,
            170_000L,
            plan(165_000L, 12_000L),
            true
        );

        assertEquals(NativeMixTrigger.Action.START, decision.action);
        assertEquals(12_000L, decision.durationMs);
    }

    @Test
    public void unknownCueRunsTheFallbackFadeAtTheEndOfTheTrack() {
        NativeMixTrigger.Decision early = NativeMixTrigger.evaluate(
            true,
            170_000L,
            TRACK_MS,
            NativeTransitionPlan.safeFallback("one", "two", 4_000L, "missing_plan"),
            true
        );
        NativeMixTrigger.Decision atCue = NativeMixTrigger.evaluate(
            true,
            175_950L,
            TRACK_MS,
            NativeTransitionPlan.safeFallback("one", "two", 4_000L, "missing_plan"),
            true
        );

        assertEquals(NativeMixTrigger.Action.WAIT, early.action);
        assertEquals(NativeMixTrigger.Action.START, atCue.action);
        assertEquals(4_000L, atCue.durationMs);
    }

    @Test
    public void gaplessPlansAndPausedPlaybackNeverStartAMix() {
        assertEquals(
            NativeMixTrigger.Action.FALL_BACK,
            NativeMixTrigger.evaluate(
                true,
                175_000L,
                TRACK_MS,
                NativeTransitionPlan.safeFallback("one", "two", 0L, "album"),
                true
            ).action
        );
        assertEquals(
            NativeMixTrigger.Action.WAIT,
            NativeMixTrigger.evaluate(
                false,
                170_000L,
                TRACK_MS,
                plan(165_000L, 12_000L),
                true
            ).action
        );
    }

    private static NativeTransitionPlan plan(long outgoingCueMs, long durationMs) {
        return NativeTransitionPlan.safeFallback("one", "two", durationMs, "test")
            .withTiming(outgoingCueMs, 8_000L, durationMs);
    }
}
