package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.Player;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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

    @Test
    public void resumeAuthorizationBlocksEveryExternalSeekCommand() {
        assertTrue(
            CrateNativePlaybackService.isCommandBlockedDuringResumeAuthorization(
                Player.COMMAND_SEEK_TO_DEFAULT_POSITION
            )
        );
        assertTrue(
            CrateNativePlaybackService.isCommandBlockedDuringResumeAuthorization(
                Player.COMMAND_SEEK_TO_MEDIA_ITEM
            )
        );
    }

    @Test
    public void nativeEventSequenceSurvivesServiceRecreation() {
        NativeEventSequence firstService = new NativeEventSequence();
        long first = firstService.next();
        NativeEventSequence recreatedService = new NativeEventSequence();
        long second = recreatedService.next();

        assertTrue(second > first);
    }

    @Test
    public void positionCoalescingPreservesGlobalEventOrder() {
        List<String> events = new ArrayList<>(
            Arrays.asList("position:1", "track:2", "state:3")
        );

        CrateNativePlaybackService.coalesceLatestPositionEvent(
            events,
            "position:4",
            event -> event.startsWith("position:")
        );

        assertEquals(Arrays.asList("track:2", "state:3", "position:4"), events);
    }
}
