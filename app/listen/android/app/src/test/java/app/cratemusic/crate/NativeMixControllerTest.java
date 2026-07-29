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
        controller.applyProgress(0.5f);
        assertEquals(
            (float) Math.sqrt(0.5),
            deckA.volume,
            0.0001f
        );
        assertEquals(
            (float) Math.sqrt(0.5),
            deckB.volume,
            0.0001f
        );
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
        assertFalse(deckB.playing);
        assertEquals(1, listener.cancellations);
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

    private static NativeTrack track(String id) {
        return new NativeTrack(
            id,
            "https://example.test/" + id,
            "",
            id,
            "Artist",
            "Album",
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
