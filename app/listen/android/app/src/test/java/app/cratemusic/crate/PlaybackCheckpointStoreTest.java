package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

public class PlaybackCheckpointStoreTest {
    @Test
    public void serializesOnlySafeResumptionMetadata() {
        PlaybackCheckpointStore.Checkpoint checkpoint =
            new PlaybackCheckpointStore.Checkpoint(
                "revision-1",
                Arrays.asList(
                    new PlaybackCheckpointStore.SafeTrack(
                        "track-1",
                        "Track",
                        "Artist",
                        "Album",
                        "https://api.example/artwork/1?token=secret",
                        180_000L
                    )
                ),
                0,
                12_500L,
                "all",
                true
            );

        String serialized = PlaybackCheckpointStore.serialize(checkpoint);

        assertFalse(serialized.contains("secret"));
        assertFalse(serialized.contains("authorization"));
        assertFalse(serialized.contains("/stream"));
        assertTrue(serialized.contains("track-1"));

        PlaybackCheckpointStore.Checkpoint restored =
            PlaybackCheckpointStore.deserialize(serialized);
        assertEquals("revision-1", restored.revision);
        assertEquals(12_500L, restored.positionMs);
        assertEquals("https://api.example/artwork/1", restored.tracks.get(0).artwork);
    }
}
