package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Before;
import org.junit.Test;

public class NativeMixControllerTest {
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
    }

    @Test
    public void preparesOnlyTheAdjacentTrackOnStandby() {
        controller.setQueue(queue, 0, false);
        controller.setEnabled(true);

        assertSame(deckA, controller.activeDeck());
        assertSame(deckB, controller.standbyDeck());
        assertEquals("one", deckA.preparedTrack.id);
        assertEquals("two", deckB.preparedTrack.id);
        assertFalse(deckB.calls.contains("prepare:three"));
    }

    @Test
    public void preparesTheActiveDeckAtTheRequestedResumePosition() {
        controller.setQueue(queue, 1, 12_500L, false);

        assertEquals("two", deckA.preparedTrack.id);
        assertEquals(12_500L, deckA.positionMs);
    }

    @Test
    public void equalPowerMixHandsOffAndAdvancesExactlyOnce() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        NativeTransitionPlan plan = NativeTransitionPlan.safeFallback(
            "one",
            "two",
            4000,
            "local_fallback"
        );

        assertTrue(controller.beginTransition(plan));
        assertTrue(deckA.calls.contains("envelope:OUTGOING:4000:0.0"));
        assertTrue(deckB.calls.contains("envelope:INCOMING:4000:0.0"));
        deckB.envelopeProgress = 0.5f;
        assertEquals(0.5f, controller.transitionProgress(), 0.0f);
        controller.applyProgress(controller.transitionProgress());
        assertEquals(1, controller.logicalIndex());
        assertEquals(1, listener.handoffs);

        controller.applyProgress(1.0f);
        controller.applyProgress(1.0f);

        assertEquals(1, controller.logicalIndex());
        assertEquals(1, listener.handoffs);
        assertSame(deckB, controller.activeDeck());
        assertEquals("three", deckA.preparedTrack.id);
    }

    @Test
    public void preparesTheStandbyAtThePlannedIncomingCue() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);

        controller.prepareStandbyAt(8_000L);
        controller.prepareStandbyAt(8_000L);

        assertEquals("two", deckB.preparedTrack.id);
        assertEquals(8_000L, deckB.positionMs);
        assertEquals(2, countCalls(deckB, "prepare:two"));
    }

    @Test
    public void neverStartsIncomingBeforeTheStandbyIsReadyAtItsCue() {
        deckB.autoReady = false;
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        controller.prepareStandbyAt(8_000L);
        NativeTransitionPlan plan = NativeTransitionPlan.safeFallback(
            "one",
            "two",
            4_000L,
            "test"
        ).withTiming(165_000L, 8_000L, 4_000L);

        assertFalse(controller.isStandbyReadyAt(8_000L, 1_000L));
        assertFalse(controller.beginTransition(plan));
        assertFalse(deckB.playing);
        assertFalse(controller.isTransitionActive());
        assertEquals(0, listener.failures);

        deckB.completePreparation();

        assertTrue(controller.isStandbyReadyAt(8_000L, 1_000L));
        assertTrue(controller.beginTransition(plan));
        assertTrue(deckB.playing);
        assertEquals(8_000L, deckB.positionMs);
        assertFalse(deckB.calls.contains("seek:8000"));
    }

    @Test
    public void standbyWithTooLittleBufferIsNotReady() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        controller.prepareStandbyAt(8_000L);
        deckB.bufferedAheadMs = 300L;

        assertFalse(controller.isStandbyReadyAt(8_000L, 1_000L));
    }

    @Test
    public void mixEnvelopePreservesTheUserVolume() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        controller.setOutputVolume(0.5f);

        controller.beginTransition(
            NativeTransitionPlan.safeFallback(
                "one",
                "two",
                4000,
                "local_fallback"
            )
        );
        controller.applyProgress(0.5f);

        assertEquals(0.5f, deckA.volume, 0.0001f);
        assertEquals(0.5f, deckB.volume, 0.0001f);

        controller.applyProgress(1.0f);
        assertEquals(0.5f, deckB.volume, 0.0001f);
        assertEquals("clear-envelope", deckB.calls.get(deckB.calls.size() - 1));
    }

    @Test
    public void focusDuckingAppliesWithoutChangingTheUserVolume() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        controller.setOutputVolume(0.8f);

        controller.setDuckMultiplier(0.25f);
        assertEquals(0.2f, deckA.volume, 0.0001f);

        controller.beginTransition(
            NativeTransitionPlan.safeFallback(
                "one",
                "two",
                4000,
                "local_fallback"
            )
        );
        controller.applyProgress(0.25f);

        assertEquals(0.2f, deckA.volume, 0.0001f);
        assertEquals(0.2f, deckB.volume, 0.0001f);

        controller.setDuckMultiplier(1.0f);
        assertEquals(0.8f, deckA.volume, 0.0001f);
        assertEquals(0.8f, deckB.volume, 0.0001f);
        assertTrue(deckA.calls.contains("envelope:OUTGOING:4000:0.0"));
        assertEquals(1, countCalls(deckA, "envelope:"));
    }

    @Test
    public void preparationFailureFallsBackWithoutAdvancing() {
        deckB.failPreparation = true;
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);

        assertFalse(
            controller.beginTransition(
                NativeTransitionPlan.safeFallback(
                    "one",
                    "two",
                    3000,
                    "local_fallback"
                )
            )
        );
        assertEquals(0, controller.logicalIndex());
        assertEquals(1, listener.failures);
        assertTrue(deckA.playing);
    }

    @Test
    public void cancellationBeforeHandoffKeepsOutgoingDeck() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        controller.beginTransition(
            NativeTransitionPlan.safeFallback(
                "one",
                "two",
                3000,
                "local_fallback"
            )
        );

        controller.applyProgress(0.25f);
        controller.cancel("seek");

        assertSame(deckA, controller.activeDeck());
        assertEquals(0, controller.logicalIndex());
        assertEquals(1.0f, deckA.volume, 0.0001f);
        assertTrue(
            deckA.calls.indexOf("clear-envelope") <
                deckA.calls.lastIndexOf("volume:1.0")
        );
        assertFalse(deckB.playing);
        assertEquals(1, listener.cancellations);
    }

    @Test
    public void reportsWhetherADeckTransitionIsActive() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        assertFalse(controller.isTransitionActive());

        controller.beginTransition(
            NativeTransitionPlan.safeFallback(
                "one",
                "two",
                3000,
                "local_fallback"
            )
        );
        assertTrue(controller.isTransitionActive());

        controller.applyProgress(1.0f);
        assertFalse(controller.isTransitionActive());
    }

    @Test
    public void repeatOneAndQueueEndNeverArmCrossfade() {
        controller.setQueue(queue, 2, true);
        controller.setEnabled(true);
        assertFalse(controller.hasPreparedStandby());

        controller.setQueue(queue, 0, true);
        controller.setRepeatOne(true);
        assertFalse(controller.hasPreparedStandby());
    }

    @Test
    public void queueUpdateRepreparesOnlyTheChangedAdjacentTrack() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
        int activePreparations = countCalls(deckA, "prepare:");
        NativeTrack inserted = track("inserted");

        controller.updateQueue(
            Arrays.asList(queue.get(0), inserted, queue.get(1), queue.get(2)),
            "one"
        );

        assertEquals(activePreparations, countCalls(deckA, "prepare:"));
        assertEquals("inserted", deckB.preparedTrack.id);
        assertEquals(0, controller.logicalIndex());
    }

    @Test
    public void naturalTrackAdvancePreparesTheFollowingAdjacentTrack() {
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);

        controller.onActiveTrackChanged("two");

        assertEquals(1, controller.logicalIndex());
        assertEquals("three", deckB.preparedTrack.id);
        assertSame(deckA, controller.activeDeck());
    }

    private static int countCalls(
        FakeNativePlaybackDeck deck,
        String prefix
    ) {
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

    private static final class RecordingListener
        implements NativeMixController.Listener {
        int handoffs;
        int cancellations;
        int failures;

        @Override
        public void onHandoff(int newIndex, NativePlaybackDeck activeDeck) {
            handoffs++;
        }

        @Override
        public void onCancelled(String reason, boolean afterHandoff) {
            cancellations++;
        }

        @Override
        public void onFailed(String reason) {
            failures++;
        }
    }
}
