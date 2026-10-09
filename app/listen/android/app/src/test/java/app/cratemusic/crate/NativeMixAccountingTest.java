package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Before;
import org.junit.Test;

public class NativeMixAccountingTest {
    private FakeNativePlaybackDeck deckA;
    private FakeNativePlaybackDeck deckB;
    private NativeMixController controller;
    private NativePlayEventCheckpoints checkpoints;
    private List<String> startedTracks;
    private List<NativeTrack> queue;

    @Before
    public void setUp() {
        deckA = new FakeNativePlaybackDeck("A");
        deckB = new FakeNativePlaybackDeck("B");
        controller = new NativeMixController(deckA, deckB, new SilentListener());
        checkpoints = new NativePlayEventCheckpoints(5_000L);
        startedTracks = new ArrayList<>();
        queue = Arrays.asList(track("one"), track("two"), track("three"));
        controller.setQueue(queue, 0, true);
        controller.setEnabled(true);
    }

    @Test
    public void aFullTransitionStartsExactlyOnePlayEventPerAudibleTrack() {
        tickFacade(0L);
        tickFacade(5_000L);
        tickFacade(170_000L);
        long execution = begin();
        tickFacade(172_000L);
        controller.applyProgress(execution, 0.5f);
        tickFacade(2_000L);
        controller.applyProgress(execution, 1.0f);
        tickFacade(4_000L);
        tickFacade(9_000L);

        assertEquals(Arrays.asList("one", "two"), startedTracks);
    }

    @Test
    public void thePreloadedStandbyNeverStartsAPlayEvent() {
        tickFacade(0L);
        tickFacade(100_000L);

        assertEquals("two", deckB.preparedTrack.id);
        assertEquals(Arrays.asList("one"), startedTracks);
    }

    @Test
    public void aTransitionCancelledBeforeHandoffNeverCountsTheIncomingTrack() {
        tickFacade(0L);
        long execution = begin();
        controller.applyProgress(execution, 0.3f);
        tickFacade(172_000L);

        controller.cancel("media_session_pause");
        tickFacade(173_000L);

        assertEquals(Arrays.asList("one"), startedTracks);
    }

    @Test
    public void aCheckpointWrittenBeforeHandoffRestoresOnlyTheOutgoingDeck() {
        long execution = begin();
        controller.applyProgress(execution, 0.3f);
        deckA.positionMs = 172_400L;

        assertRestoresSingleDeck(0, "one", 172_400L);
    }

    @Test
    public void aCheckpointWrittenAfterHandoffRestoresOnlyTheIncomingDeck() {
        long execution = begin();
        controller.applyProgress(execution, 0.7f);
        deckB.positionMs = 2_800L;

        assertRestoresSingleDeck(1, "two", 2_800L);
    }

    @Test
    public void onlyAResolvedOutgoingErrorIsKeptFromJavascript() {
        long execution = begin();
        controller.applyProgress(execution, 0.25f);

        assertFalse(controller.onDeckError(deckB));

        setUp();
        execution = begin();
        controller.applyProgress(execution, 0.25f);

        assertTrue(controller.onDeckError(deckA));
        assertFalse(controller.onDeckError(controller.activeDeck()));
    }

    @Test
    public void aDeckErrorReachingBothListenersIsResolvedOnce() {
        List<NativePlaybackDeck> resolved = new ArrayList<>();
        NativeDeckErrorRouter router = new NativeDeckErrorRouter(deck -> {
            resolved.add(deck);
            return true;
        });
        Object error = new Object();

        assertTrue(router.onFacadeError(error, deckA));
        router.onPhysicalDeckError(error, deckA, false);

        assertEquals(Arrays.asList(deckA), resolved);
    }

    @Test
    public void physicalErrorsOfTheActiveDeckAreLeftToTheFacade() {
        List<NativePlaybackDeck> resolved = new ArrayList<>();
        NativeDeckErrorRouter router = new NativeDeckErrorRouter(deck -> {
            resolved.add(deck);
            return false;
        });
        Object error = new Object();

        router.onPhysicalDeckError(error, deckA, true);
        assertFalse(router.onFacadeError(error, deckA));
        router.onPhysicalDeckError(new Object(), deckB, false);

        assertEquals(Arrays.asList(deckA, deckB), resolved);
    }

    private void assertRestoresSingleDeck(
        int expectedIndex,
        String expectedTrackId,
        long expectedPositionMs
    ) {
        List<PlaybackCheckpointStore.SafeTrack> safeTracks = new ArrayList<>();
        for (NativeTrack track : controller.queueSnapshot()) {
            safeTracks.add(track.toSafeCheckpointTrack());
        }
        FakeNativePlaybackDeck facadeDeck = (FakeNativePlaybackDeck) controller.activeDeck();
        String serialized = PlaybackCheckpointStore.serialize(
            new PlaybackCheckpointStore.Checkpoint(
                "revision-1",
                safeTracks,
                controller.logicalIndex(),
                facadeDeck.positionMs,
                "off",
                true
            )
        );

        assertFalse(serialized.contains("envelope"));
        assertFalse(serialized.contains("transition"));
        PlaybackCheckpointStore.Checkpoint restored =
            PlaybackCheckpointStore.deserialize(serialized);
        assertEquals(expectedIndex, restored.index);
        assertEquals(expectedPositionMs, restored.positionMs);

        List<NativeTrack> restoredTracks = new ArrayList<>();
        for (PlaybackCheckpointStore.SafeTrack track : restored.tracks) {
            restoredTracks.add(NativeTrack.fromCheckpoint(track));
        }
        FakeNativePlaybackDeck restoredActive = new FakeNativePlaybackDeck("A2");
        FakeNativePlaybackDeck restoredStandby = new FakeNativePlaybackDeck("B2");
        NativeMixController restoredController = new NativeMixController(
            restoredActive,
            restoredStandby,
            new SilentListener()
        );
        restoredController.setQueue(
            restoredTracks,
            restored.index,
            restored.positionMs,
            false
        );

        assertFalse(restoredController.isTransitionActive());
        assertEquals(expectedTrackId, restoredActive.preparedTrack.id);
        assertEquals(expectedPositionMs, restoredActive.positionMs);
        assertFalse(restoredActive.playing);
        assertNull(restoredActive.envelopeRole);
        assertFalse(restoredStandby.playing);
        assertNull(restoredStandby.envelopeRole);
    }

    private long begin() {
        assertTrue(
            controller.beginTransition(
                NativeTransitionPlan.safeFallback("one", "two", 4000, "test")
            )
        );
        return controller.executionId();
    }

    private void tickFacade(long positionMs) {
        FakeNativePlaybackDeck facade = (FakeNativePlaybackDeck) controller.activeDeck();
        NativePlayEventCheckpoints.Checkpoint checkpoint = checkpoints.observe(
            controller.logicalIndex(),
            facade.preparedTrack.id,
            positionMs,
            facade.playing
        );
        if (checkpoint != null && checkpoint.firstForTrack) {
            startedTracks.add(checkpoint.trackId);
        }
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

    private static final class SilentListener implements NativeMixController.Listener {
        @Override
        public void onHandoff(
            long executionId,
            int newIndex,
            NativePlaybackDeck activeDeck
        ) {}

        @Override
        public void onCompleted(long executionId, int finalIndex) {}

        @Override
        public void onCancelled(
            long executionId,
            String reason,
            boolean afterHandoff
        ) {}

        @Override
        public void onFailed(String reason) {}
    }
}
