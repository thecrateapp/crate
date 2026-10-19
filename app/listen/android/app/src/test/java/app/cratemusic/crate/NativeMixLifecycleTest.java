package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Consumer;

import org.json.JSONException;
import org.json.JSONObject;

import org.junit.Before;
import org.junit.Test;

public class NativeMixLifecycleTest {
    private FakeNativePlaybackDeck deckA;
    private FakeNativePlaybackDeck deckB;
    private RecordingListener listener;
    private NativeMixController controller;
    private List<NativeTrack> queue;

    @Before
    public void setUp() {
        deckA = new FakeNativePlaybackDeck("A");
        deckB = new FakeNativePlaybackDeck("B");
        listener = new RecordingListener();
        controller = new NativeMixController(deckA, deckB, listener);
        queue = Arrays.asList(track("one"), track("two"), track("three"));
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
    }

    @Test
    public void progressFromACancelledExecutionNeverAdvancesTheQueue() {
        long first = begin();
        controller.cancel("media_session_seek");
        long second = begin();

        controller.applyProgress(first, 1.0f);

        assertNotEquals(first, second);
        assertEquals(0, controller.logicalIndex());
        assertEquals(0, listener.handoffs.size());
        assertTrue(controller.isTransitionActive());

        controller.applyProgress(second, 1.0f);

        assertEquals(1, controller.logicalIndex());
        assertEquals(Arrays.asList(second), listener.handoffs);
        assertEquals(Arrays.asList(second), listener.completions);
    }

    @Test
    public void eachExecutionHandsOffAndCompletesExactlyOnce() {
        long execution = begin();

        controller.applyProgress(execution, 0.5f);
        controller.applyProgress(execution, 0.6f);
        controller.applyProgress(execution, 1.0f);
        controller.applyProgress(execution, 1.0f);

        assertEquals(Arrays.asList(execution), listener.handoffs);
        assertEquals(Arrays.asList(execution), listener.completions);
        assertEquals(1, controller.logicalIndex());
        assertSame(deckB, controller.activeDeck());
    }

    @Test
    public void everyInterruptionBeforeHandoffKeepsOneAudibleOutgoingDeck() {
        for (Interruption interruption : interruptions()) {
            setUp();
            long execution = begin();
            controller.applyProgress(execution, 0.25f);

            interruption.action.accept(controller);

            assertFalse(interruption.name, controller.isTransitionActive());
            assertEquals(interruption.name, 0, controller.logicalIndex());
            assertEquals(interruption.name, 0, listener.handoffs.size());
            assertSingleAudibleDeck(interruption.name, deckA, deckB);
        }
    }

    @Test
    public void everyInterruptionAfterHandoffKeepsOneAudibleIncomingDeck() {
        for (Interruption interruption : interruptions()) {
            if (interruption.replacesQueue) {
                continue;
            }
            setUp();
            long execution = begin();
            controller.applyProgress(execution, 0.75f);

            interruption.action.accept(controller);

            assertFalse(interruption.name, controller.isTransitionActive());
            assertEquals(interruption.name, 1, controller.logicalIndex());
            assertEquals(interruption.name, 1, listener.handoffs.size());
            assertSingleAudibleDeck(interruption.name, deckB, deckA);
        }
    }

    @Test
    public void interruptionsBeforeAnyTransitionLeaveThePreparedStandbySilent() {
        controller.cancel("media_session_pause");
        controller.setDuckMultiplier(0.2f);

        assertFalse(controller.isTransitionActive());
        assertFalse(deckB.playing);
        assertEquals(0.0f, deckB.volume, 0.0f);
        assertEquals(0, listener.cancellations.size());
    }

    @Test
    public void appendingTracksDuringATransitionKeepsTheMix() {
        long execution = begin();
        List<NativeTrack> extended = new ArrayList<>(queue);
        extended.add(track("four"));

        controller.updateQueue(extended, "one");

        assertTrue(controller.isTransitionActive());
        assertEquals(0, listener.cancellations.size());
        controller.applyProgress(execution, 1.0f);
        assertEquals(1, controller.logicalIndex());
        assertEquals("three", deckA.preparedTrack.id);
    }

    @Test
    public void queueChangesThatBreakTheMixedEdgeCancelIt() {
        long execution = begin();

        controller.updateQueue(Arrays.asList(queue.get(0), queue.get(2)), "one");

        assertFalse(controller.isTransitionActive());
        assertEquals(Arrays.asList(execution), listener.cancellations);
        assertSingleAudibleDeck("queue_updated", deckA, deckB);
        assertEquals("three", deckB.preparedTrack.id);
    }

    @Test
    public void incomingDeckErrorBeforeHandoffRestoresTheOutgoingDeck() {
        long execution = begin();
        controller.applyProgress(execution, 0.25f);

        controller.onDeckError(deckB);

        assertFalse(controller.isTransitionActive());
        assertEquals(0, controller.logicalIndex());
        assertEquals(Arrays.asList(execution), listener.cancellations);
        assertEquals("incoming_deck_error", listener.lastCancellationReason);
        assertSingleAudibleDeck("incoming_error", deckA, deckB);
    }

    @Test
    public void outgoingDeckErrorBeforeHandoffHandsOffToTheIncomingDeck() {
        long execution = begin();
        controller.applyProgress(execution, 0.25f);

        controller.onDeckError(deckA);

        assertFalse(controller.isTransitionActive());
        assertEquals(1, controller.logicalIndex());
        assertEquals(Arrays.asList(execution), listener.handoffs);
        assertEquals(Arrays.asList(execution), listener.completions);
        assertSingleAudibleDeck("outgoing_error", deckB, deckA);
    }

    @Test
    public void outgoingDeckErrorAfterHandoffCompletesTheTransition() {
        long execution = begin();
        controller.applyProgress(execution, 0.75f);

        controller.onDeckError(deckA);

        assertFalse(controller.isTransitionActive());
        assertEquals(Arrays.asList(execution), listener.handoffs);
        assertEquals(Arrays.asList(execution), listener.completions);
        assertSingleAudibleDeck("outgoing_error_after_handoff", deckB, deckA);
    }

    @Test
    public void standbyDeckErrorRetriesAfterTheBackoff() {
        controller.onDeckError(deckB);
        int preparations = countCalls(deckB, "prepare:");

        assertFalse(controller.beginTransition(plan()));
        controller.prepareStandbyAt(0L, 1_000L);
        controller.prepareStandbyAt(
            0L,
            1_000L + NativeMixController.STANDBY_RETRY_MS - 1L
        );

        assertNull(deckB.preparedTrack);
        assertEquals(preparations, countCalls(deckB, "prepare:"));
        assertEquals(1, listener.failures);

        controller.prepareStandbyAt(
            0L,
            1_000L + NativeMixController.STANDBY_RETRY_MS
        );

        assertEquals("two", deckB.preparedTrack.id);
        assertEquals(preparations + 1, countCalls(deckB, "prepare:"));
    }

    @Test
    public void standbyDeckErrorStillRecoversWhenTheQueueChanges() {
        controller.onDeckError(deckB);

        controller.updateQueue(queue, "one");

        assertEquals("two", deckB.preparedTrack.id);
    }

    @Test
    public void repeatedStandbyErrorsWaitAFullBackoffEachTime() {
        controller.onDeckError(deckB);
        controller.prepareStandbyAt(0L, 0L);
        controller.prepareStandbyAt(0L, NativeMixController.STANDBY_RETRY_MS);
        int preparations = countCalls(deckB, "prepare:");

        controller.onDeckError(deckB);
        controller.prepareStandbyAt(0L, NativeMixController.STANDBY_RETRY_MS + 1L);
        controller.prepareStandbyAt(
            0L,
            2 * NativeMixController.STANDBY_RETRY_MS
        );

        assertEquals(preparations, countCalls(deckB, "prepare:"));
    }

    @Test
    public void activeDeckErrorWithoutATransitionIsLeftToThePlayer() {
        controller.onDeckError(deckA);

        assertEquals(0, listener.failures);
        assertEquals(0, listener.cancellations.size());
        assertEquals("two", deckB.preparedTrack.id);
    }

    @Test
    public void stalledTransitionBeforeHandoffCancelsAfterTheTimeout() {
        long execution = begin();
        controller.observeProgress(execution, 0.2f, 1_000L);

        controller.observeProgress(
            execution,
            0.2f,
            1_000L + NativeMixController.STALL_TIMEOUT_MS - 1L
        );
        assertTrue(controller.isTransitionActive());

        controller.observeProgress(
            execution,
            0.2f,
            1_000L + NativeMixController.STALL_TIMEOUT_MS
        );

        assertFalse(controller.isTransitionActive());
        assertEquals("transition_stalled", listener.lastCancellationReason);
        assertSingleAudibleDeck("stalled_before_handoff", deckA, deckB);
    }

    @Test
    public void stalledTransitionAfterHandoffCompletesOnTheIncomingDeck() {
        long execution = begin();
        controller.observeProgress(execution, 0.8f, 1_000L);

        controller.observeProgress(
            execution,
            0.8f,
            1_000L + NativeMixController.STALL_TIMEOUT_MS
        );

        assertFalse(controller.isTransitionActive());
        assertEquals(Arrays.asList(execution), listener.completions);
        assertSingleAudibleDeck("stalled_after_handoff", deckB, deckA);
    }

    @Test
    public void advancingProgressNeverCountsAsAStall() {
        long execution = begin();
        controller.observeProgress(execution, 0.1f, 1_000L);
        controller.observeProgress(execution, 0.2f, 3_000L);

        controller.observeProgress(
            execution,
            0.3f,
            3_000L + NativeMixController.STALL_TIMEOUT_MS - 1L
        );

        assertTrue(controller.isTransitionActive());
        assertEquals(0, listener.cancellations.size());
    }

    @Test
    public void duckingDuringATransitionKeepsMixingBothDecks() {
        long execution = begin();
        controller.applyProgress(execution, 0.25f);

        controller.setDuckMultiplier(0.25f);

        assertTrue(controller.isTransitionActive());
        assertEquals(0.25f, deckA.volume, 0.0001f);
        assertEquals(0.25f, deckB.volume, 0.0001f);
        assertTrue(deckA.playing);
        assertTrue(deckB.playing);
    }

    private static NativeTransitionPlan beatmatchPlan() {
        try {
            JSONObject json = new JSONObject();
            json.put("plannerVersion", 2);
            json.put("outgoingTrackId", "one");
            json.put("incomingTrackId", "two");
            json.put("mode", "beatmatch");
            json.put("durationMs", 4000);
            json.put("outgoingCueMs", 170000);
            json.put("incomingCueMs", 8000);
            json.put("incomingTempoRatio", 1.04);
            json.put("beatPhaseOffsetMs", 100);
            json.put("handoffProgress", 0.5);
            json.put("outgoingGainDb", 0.0);
            json.put("incomingGainDb", 0.0);
            json.put("curve", "equal-power");
            json.put("bassHandoff", "balanced");
            json.put("confidence", 0.9);
            return NativeTransitionPlan.fromJson(json, "one", "two", 4000L);
        } catch (JSONException error) {
            throw new AssertionError(error);
        }
    }

    @Test
    public void beatmatchPreparesAPrerollBeforeThePhaseAlignedCue() {
        assertEquals(8104L, beatmatchPlan().startIncomingCueMs());
        assertEquals(8104L - 1040L, beatmatchPlan().prepareIncomingCueMs());
        assertEquals(0L, plan().startIncomingCueMs());
        assertEquals(0L, plan().prepareIncomingCueMs());
    }

    @Test
    public void prerollHoldsTheIncomingDeckMutedAtTheTempoRatio() {
        preroll();

        assertTrue(controller.isPrerolling());
        assertTrue(deckB.held);
        assertTrue(deckB.playing);
        assertEquals(0.0f, deckB.volume, 0.0f);
        assertEquals(1.04f, deckB.speed, 0.0001f);
        assertEquals(1.0f, deckA.speed, 0.0f);
    }

    @Test
    public void aDeckThatCannotHoldItsStartDoesNotPreroll() {
        deckB.supportsHold = false;
        controller.prepareStandbyAt(beatmatchPlan().prepareIncomingCueMs(), 0L);

        assertFalse(controller.beginPreroll(beatmatchPlan()));
        assertFalse(deckB.playing);
    }

    @Test
    public void theHeldStartIsScheduledWhereTheIncomingCueMeetsTheOutgoingCue() {
        preroll();
        deckB.positionMs = beatmatchPlan().prepareIncomingCueMs();
        deckA.positionMs = 167600L;
        deckB.busFrame = 1_000L;

        assertTrue(controller.scheduleHeldStart());

        long delayMs = (170000L - 167600L) - 1000L;
        assertEquals(1_000L + delayMs * 48L, deckB.startFrame);
    }

    @Test
    public void theHeldStartUsesTheMedianOfItsEstimates() {
        preroll();
        deckB.positionMs = beatmatchPlan().prepareIncomingCueMs();
        deckB.busFrame = 0L;
        deckA.positionMs = 167600L;
        controller.scheduleHeldStart();
        deckA.positionMs = 167000L;
        controller.scheduleHeldStart();
        deckA.positionMs = 167600L;
        controller.scheduleHeldStart();

        assertEquals(1400L * 48L, deckB.startFrame);
    }

    @Test
    public void theHeldStartIsNotRescheduledOnceTheIncomingDeckMoves() {
        preroll();
        deckA.positionMs = 167600L;
        controller.scheduleHeldStart();
        deckB.positionMs += 20L;

        assertFalse(controller.scheduleHeldStart());
    }

    @Test
    public void anInPhasePrerollMixesWithTheTempoRatio() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        controller.measurePhase();
        controller.measurePhase();

        assertTrue(controller.beginTransition(mixPlan()));

        assertFalse(controller.isPrerolling());
        assertTrue(controller.isBeatmatching());
        assertEquals(1.04f, deckB.speed, 0.0001f);
        assertTrue(deckB.calls.contains("envelope:INCOMING:4160:0.0"));
    }

    @Test
    public void anEngagedBeatmatchSwapsBassAtTheHandoff() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        controller.measurePhase();
        controller.measurePhase();

        assertTrue(controller.beginTransition(mixPlan()));

        assertEquals(0.5f, deckA.bassHandoffAt, 0.0f);
        assertEquals(0.5f, deckB.bassHandoffAt, 0.0f);
    }

    @Test
    public void anAdaptiveFallbackKeepsBothBasses() {
        preroll();

        assertTrue(controller.beginTransition(mixPlan()));

        assertTrue(Float.isNaN(deckA.bassHandoffAt));
        assertTrue(Float.isNaN(deckB.bassHandoffAt));
    }

    @Test
    public void anOutOfPhasePrerollMixesAsAdaptive() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        alignPositions(100L);
        controller.measurePhase();
        controller.measurePhase();

        assertTrue(controller.beginTransition(mixPlan()));

        assertFalse(controller.isBeatmatching());
        assertFalse(deckB.held);
        assertEquals(1.0f, deckB.speed, 0.0f);
        assertTrue(deckB.calls.contains("envelope:INCOMING:4000:0.0"));
    }

    @Test
    public void aSingleNoisyPhaseSampleDoesNotPreventTheBeatmatch() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        controller.measurePhase();
        alignPositions(30L);
        controller.measurePhase();
        alignPositions(0L);
        controller.measurePhase();

        assertTrue(controller.beginTransition(mixPlan()));

        assertTrue(controller.isBeatmatching());
    }

    @Test
    public void theReportedPhaseErrorIgnoresASingleOutlier() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        controller.measurePhase();
        alignPositions(60L);
        controller.measurePhase();

        assertEquals(0.0f, controller.medianPhaseErrorMs(), 0.5f);
    }

    @Test
    public void aPrerollThatNeverStartedReleasesTheHeldDeck() {
        preroll();

        assertTrue(controller.beginTransition(mixPlan()));

        assertFalse(controller.isBeatmatching());
        assertFalse(deckB.held);
    }

    @Test
    public void aBeatmatchPlanWithoutPrerollMixesAsAdaptive() {
        controller.prepareStandbyAt(8104L, 0L);

        assertTrue(controller.beginTransition(mixPlan()));

        assertFalse(controller.isBeatmatching());
        assertFalse(deckB.calls.contains("speed:1.04"));
        assertTrue(deckB.calls.contains("envelope:INCOMING:4000:0.0"));
    }

    @Test
    public void theMixNeverChangesTheIncomingSpeed() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        controller.measurePhase();
        controller.measurePhase();
        assertTrue(controller.beginTransition(mixPlan()));
        alignPositions(50L);
        controller.measurePhase();

        assertEquals(50.0f, controller.lastPhaseErrorMs(), 1.0f);
        assertEquals(1.04f, deckB.speed, 0.0001f);
    }

    @Test
    public void completionLeavesTheTempoRestorePending() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(0L);
        controller.measurePhase();
        controller.measurePhase();
        controller.measurePhase();
        assertTrue(controller.beginTransition(mixPlan()));

        controller.applyProgress(controller.executionId(), 1.0f);

        assertEquals(1.04f, controller.pendingTempoRestoreSpeed(), 0.0001f);
        controller.clearPendingTempoRestore();
        assertEquals(1.0f, controller.pendingTempoRestoreSpeed(), 0.0f);
    }

    @Test
    public void aPrerolledMixStartsEvenWhenTheDeckDriftedFromItsCue() {
        preroll();
        controller.scheduleHeldStart();
        alignPositions(400L);
        controller.measurePhase();

        assertTrue(controller.isStandbyReadyAt(8104L, 1_000L));
        assertTrue(controller.beginTransition(mixPlan()));
        assertFalse(controller.isBeatmatching());
    }

    @Test
    public void aPrerollRebuffersTheHeldDeckAtItsTempoRatio() {
        controller.prepareStandbyAt(beatmatchPlan().prepareIncomingCueMs(), 0L);
        deckB.calls.clear();

        assertTrue(controller.beginPreroll(beatmatchPlan()));
        assertFalse(deckB.calls.contains("seek:" + beatmatchPlan().prepareIncomingCueMs()));
        rebuffer();

        int speed = deckB.calls.indexOf("speed:1.04");
        int play = deckB.calls.indexOf("play");
        int seek = deckB.calls.indexOf("seek:" + (beatmatchPlan().prepareIncomingCueMs() + 1L));
        assertTrue(speed >= 0);
        assertTrue(play > speed);
        assertTrue(seek > play);
    }

    @Test
    public void aPrerollSeeksAStandbyPreparedElsewhereToTheHeldCue() {
        controller.prepareStandbyAt(0L, 0L);

        assertTrue(controller.beginPreroll(beatmatchPlan()));
        rebuffer();

        assertEquals(8104L - 1040L, deckB.positionMs);
    }

    @Test
    public void aPlanWithoutPrerollRoomIsShiftedLaterKeepingItsPhase() {
        NativeTransitionPlan early = beatmatchPlan().withTiming(170000L, 0L, 4000L);

        NativeTransitionPlan shifted = early.withPrerollRoom(240000L);

        long roomMs = Math.round(104L / 1.04);
        long shiftMs = NativeMixController.PREROLL_LEAD_MS - roomMs;
        assertEquals(170000L + shiftMs, shifted.outgoingCueMs);
        assertEquals(Math.round(shiftMs * 1.04), shifted.incomingCueMs);
        NativeTransitionPlan roomy = beatmatchPlan();
        assertSame(roomy, roomy.withPrerollRoom(240000L));
        assertEquals(170000L, early.withPrerollRoom(174000L).outgoingCueMs);
    }

    @Test
    public void phaseIsNotMeasuredUntilTheHeldDeckStartsMoving() {
        preroll();
        controller.scheduleHeldStart();
        deckA.positionMs = 168000L;

        controller.measurePhase();

        assertEquals(0.0f, controller.lastPhaseErrorMs(), 0.0f);
    }

    @Test
    public void cancellingThePrerollResetsTheStandby() {
        preroll();

        controller.cancelPreroll();

        assertFalse(controller.isPrerolling());
        assertFalse(deckB.held);
        assertEquals(1.0f, deckB.speed, 0.0f);
        assertFalse(deckB.playing);
    }

    @Test
    public void aDeckThatCannotChangeSpeedDoesNotPreroll() {
        deckB.failSpeed = true;
        controller.prepareStandbyAt(beatmatchPlan().prepareIncomingCueMs(), 0L);

        assertFalse(controller.beginPreroll(beatmatchPlan()));
        assertFalse(controller.isPrerolling());
        assertFalse(deckB.held);
    }

    private void preroll() {
        controller.prepareStandbyAt(beatmatchPlan().prepareIncomingCueMs(), 0L);
        deckA.positionMs = 167500L;
        assertTrue(controller.beginPreroll(beatmatchPlan()));
        rebuffer();
    }

    private void rebuffer() {
        for (int tick = 0; tick < NativeMixController.PREROLL_REBUFFER_TICKS; tick++) {
            assertFalse(controller.scheduleHeldStart());
        }
    }

    private void alignPositions(long incomingLagMs) {
        deckA.positionMs = 170000L;
        deckB.positionMs = 8104L - Math.round(incomingLagMs * 1.04f);
    }

    private static NativeTransitionPlan mixPlan() {
        return beatmatchPlan().withTiming(170000L, 8104L, 4000L);
    }

    private long begin(NativeTransitionPlan transitionPlan) {
        controller.prepareStandbyAt(transitionPlan.incomingCueMs, 0L);
        assertTrue(controller.beginTransition(transitionPlan));
        return controller.executionId();
    }

    private long begin() {
        assertTrue(controller.beginTransition(plan()));
        return controller.executionId();
    }

    private static NativeTransitionPlan plan() {
        return NativeTransitionPlan.safeFallback("one", "two", 4000, "test");
    }

    private static void assertSingleAudibleDeck(
        String context,
        FakeNativePlaybackDeck audible,
        FakeNativePlaybackDeck silent
    ) {
        assertTrue(context, audible.playing);
        assertNull(context, audible.envelopeRole);
        assertFalse(context, silent.playing);
    }

    private static List<Interruption> interruptions() {
        return Arrays.asList(
            new Interruption("pause", false, c -> c.cancel("media_session_pause")),
            new Interruption("seek", false, c -> c.cancel("media_session_seek")),
            new Interruption("stop", false, c -> c.cancel("media_session_stop")),
            new Interruption("focus_loss", false, c -> c.cancel("focus_loss")),
            new Interruption("route_change", false, c -> c.cancel("noisy_route")),
            new Interruption("service_close", false, c -> c.cancel("service_destroyed")),
            new Interruption("repeat_one", false, c -> c.setRepeatOne(true)),
            new Interruption("disable", false, c -> c.setEnabled(false)),
            new Interruption(
                "queue_replaced",
                true,
                c -> c.setQueue(
                    Arrays.asList(track("one"), track("two"), track("three")),
                    0,
                    true
                )
            )
        );
    }

    private static int countCalls(FakeNativePlaybackDeck deck, String prefix) {
        int count = 0;
        for (String call : deck.calls) {
            if (call.startsWith(prefix)) {
                count++;
            }
        }
        return count;
    }

    private static NativeTrack track(String id) {
        return new NativeTrack(
            id,
            "https://example.test/" + id,
            "",
            id,
            "Artist",
            "Album",
            "",
            "",
            180000,
            null
        );
    }

    private static final class Interruption {
        final String name;
        final boolean replacesQueue;
        final Consumer<NativeMixController> action;

        Interruption(
            String name,
            boolean replacesQueue,
            Consumer<NativeMixController> action
        ) {
            this.name = name;
            this.replacesQueue = replacesQueue;
            this.action = action;
        }
    }

    private static final class RecordingListener
        implements NativeMixController.Listener {
        final List<Long> handoffs = new ArrayList<>();
        final List<Long> completions = new ArrayList<>();
        final List<Long> cancellations = new ArrayList<>();
        String lastCancellationReason;
        int failures;

        @Override
        public void onHandoff(
            long executionId,
            int newIndex,
            NativePlaybackDeck activeDeck
        ) {
            handoffs.add(executionId);
        }

        @Override
        public void onCompleted(long executionId, int finalIndex) {
            completions.add(executionId);
        }

        @Override
        public void onCancelled(
            long executionId,
            String reason,
            boolean afterHandoff
        ) {
            cancellations.add(executionId);
            lastCancellationReason = reason;
        }

        @Override
        public void onFailed(String reason) {
            failures++;
        }
    }
}
