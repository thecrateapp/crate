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
    public void standbyDeckErrorStopsRetryingUntilTheQueueChanges() {
        controller.onDeckError(deckB);
        int preparations = countCalls(deckB, "prepare:");

        assertFalse(controller.beginTransition(plan()));
        controller.prepareStandbyAt(0L);

        assertNull(deckB.preparedTrack);
        assertEquals(preparations, countCalls(deckB, "prepare:"));
        assertEquals(1, listener.failures);

        controller.updateQueue(queue, "one");

        assertEquals("two", deckB.preparedTrack.id);
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
