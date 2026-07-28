package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import org.junit.Test;

public class NativePlaybackContractTest {
    @Test
    public void shipsTheNativePlaybackService() {
        assertNotNull(CrateNativePlaybackService.class);
    }

    @Test
    public void legacyBridgeUsesStableActions() {
        assertEquals(
            "app.cratemusic.crate.playback.START",
            LegacyPlaybackContract.ACTION_START
        );
        assertEquals(
            "app.cratemusic.crate.playback.UPDATE",
            LegacyPlaybackContract.ACTION_UPDATE
        );
    }

    @Test
    public void playbackErrorsRedactEveryMediaCredential() {
        String redacted = CrateNativePlaybackService.redactUrl(
            "https://api.example/api/tracks/1/stream?token=long-secret"
                + "&media_ticket=short-secret&delivery=balanced"
        );

        assertFalse(redacted.contains("long-secret"));
        assertFalse(redacted.contains("short-secret"));
    }
}
