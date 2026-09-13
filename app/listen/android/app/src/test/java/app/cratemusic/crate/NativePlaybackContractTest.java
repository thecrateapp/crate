package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.Player;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
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
    public void resumeAuthorizationLetsExternalSeekCommandsUpdateThePendingCursor() {
        assertFalse(
            CrateNativePlaybackService.isCommandBlockedDuringResumeAuthorization(
                Player.COMMAND_SEEK_TO_DEFAULT_POSITION
            )
        );
        assertFalse(
            CrateNativePlaybackService.isCommandBlockedDuringResumeAuthorization(
                Player.COMMAND_SEEK_TO_MEDIA_ITEM
            )
        );
        assertTrue(
            CrateNativePlaybackService.isResumeAuthorizationCursorCommand(
                Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM
            )
        );
        assertTrue(
            CrateNativePlaybackService.isResumeAuthorizationCursorCommand(
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
            )
        );
        assertTrue(
            CrateNativePlaybackService.isCommandBlockedDuringResumeAuthorization(
                Player.COMMAND_PREPARE
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

    @Test
    public void nativeAuthorizationIsScopedToEachExplicitHttpsOrigin() {
        CrateNativePlaybackService.NativeTrack crateTrack = nativeTrack(
            "https://api.example/api/tracks/1/stream",
            "Bearer stream-secret",
            "https://api.example/api/albums/1/cover",
            "Bearer artwork-secret"
        );
        CrateNativePlaybackService.NativeTrack externalTrack = nativeTrack(
            "https://cdn.example/audio.flac",
            "",
            "https://covers.example/cover.jpg",
            ""
        );

        Map<String, String> streamAuthorization =
            CrateNativePlaybackService.streamAuthorizationByOrigin(
                Arrays.asList(crateTrack, externalTrack)
            );
        Map<String, String> artworkAuthorization =
            CrateNativePlaybackService.artworkAuthorizationByOrigin(
                Arrays.asList(crateTrack, externalTrack)
            );

        assertEquals("Bearer stream-secret", streamAuthorization.get("https://api.example"));
        assertEquals("Bearer artwork-secret", artworkAuthorization.get("https://api.example"));
        assertFalse(streamAuthorization.containsKey("https://cdn.example"));
        assertFalse(artworkAuthorization.containsKey("https://covers.example"));
    }

    @Test
    public void nativeAuthorizationRejectsPlainHttpOrigins() {
        CrateNativePlaybackService.NativeTrack track = nativeTrack(
            "http://api.example/api/tracks/1/stream",
            "Bearer stream-secret",
            "http://api.example/api/albums/1/cover",
            "Bearer artwork-secret"
        );

        assertTrue(
            CrateNativePlaybackService.streamAuthorizationByOrigin(
                Arrays.asList(track)
            ).isEmpty()
        );
        assertTrue(
            CrateNativePlaybackService.artworkAuthorizationByOrigin(
                Arrays.asList(track)
            ).isEmpty()
        );
    }

    private static CrateNativePlaybackService.NativeTrack nativeTrack(
        String url,
        String authorization,
        String artwork,
        String artworkAuthorization
    ) {
        return new CrateNativePlaybackService.NativeTrack(
            "track-1",
            url,
            authorization,
            "Track",
            "Artist",
            "Album",
            artwork,
            artworkAuthorization,
            180_000L,
            null
        );
    }
}
