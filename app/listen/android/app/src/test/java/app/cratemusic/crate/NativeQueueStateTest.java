package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;

import java.util.Arrays;

import org.junit.Test;

public class NativeQueueStateTest {
    @Test
    public void clampsIndexesAndRejectsStaleMutations() {
        NativeQueueState state = new NativeQueueState();
        NativeTrack first = track("first");
        NativeTrack second = track("second");

        state.replace("revision-1", Arrays.asList(first));

        assertEquals(0, state.clampPlaybackIndex(-10));
        assertEquals(0, state.clampPlaybackIndex(10));
        assertFalse(state.append("stale-revision", Arrays.asList(second)));
        assertEquals(1, state.size());
    }

    @Test
    public void appliesAppendInsertRemoveAndReorderAgainstCurrentRevision() {
        NativeQueueState state = new NativeQueueState();
        NativeTrack first = track("first");
        NativeTrack second = track("second");
        NativeTrack third = track("third");

        state.replace("revision-1", Arrays.asList(first));

        assertTrue(state.append("revision-1", Arrays.asList(second)));
        assertEquals(2, state.insert("revision-1", 99, third));
        assertEquals("third", state.get(2).canonicalId());
        assertTrue(state.reorder("revision-1", 2, 0));
        assertEquals("third", state.get(0).canonicalId());
        assertTrue(state.remove("revision-1", 1));
        assertEquals(2, state.size());
    }

    @Test
    public void checkpointProjectionNeverContainsPlaybackCredentials() {
        NativeTrack track = new NativeTrack(
            "track-1",
            "https://api.example/tracks/1/stream?media_ticket=secret",
            "Bearer secret",
            "Track",
            "Artist",
            "Album",
            "https://api.example/artwork?token=secret",
            1234L,
            null
        );

        PlaybackCheckpointStore.Checkpoint checkpoint =
            new PlaybackCheckpointStore.Checkpoint(
                "revision-1",
                Arrays.asList(track.toSafeCheckpointTrack()),
                0,
                0L,
                "off",
                false
            );
        String serialized = PlaybackCheckpointStore.serialize(checkpoint);

        assertFalse(serialized.contains("Bearer secret"));
        assertFalse(serialized.contains("media_ticket"));
        assertFalse(serialized.contains("token=secret"));
    }

    @Test
    public void telemetryBufferIsBoundedAndCoalescesPositionEvents() {
        NativePlaybackTelemetry telemetry = new NativePlaybackTelemetry(3);

        telemetry.emit("positionChanged", new JSObject());
        telemetry.emit("positionChanged", new JSObject());
        telemetry.emit("stateChanged", new JSObject());
        telemetry.emit("bufferingChanged", new JSObject());
        telemetry.emit("trackChanged", new JSObject());

        assertEquals(3, telemetry.bufferedEventCount());
        assertEquals(
            "trackChanged",
            telemetry.bufferedEventNames().get(2)
        );
    }

    private static NativeTrack track(String id) {
        return new NativeTrack(
            id,
            "https://api.example/tracks/" + id + "/stream",
            "",
            id,
            "Artist",
            "Album",
            "",
            1000L,
            null
        );
    }
}
