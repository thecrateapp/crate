package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.exoplayer.ExoPlayer;

import java.lang.reflect.Field;
import java.util.Arrays;

import org.junit.Test;

public class NativePlaybackBaselineTest {
    @Test
    public void playbackServiceOwnsOneStableMediaSession() {
        assertTrue(
            MediaSessionService.class.isAssignableFrom(CrateNativePlaybackService.class)
        );

        long sessionFields = Arrays.stream(
            CrateNativePlaybackService.class.getDeclaredFields()
        )
            .map(Field::getType)
            .filter(MediaSession.class::equals)
            .count();

        assertEquals(1L, sessionFields);
    }

    @Test
    public void playbackServiceHidesTwoPhysicalDecksBehindOneFacade() {
        long physicalPlayers = Arrays.stream(
            CrateNativePlaybackService.class.getDeclaredFields()
        )
            .map(Field::getType)
            .filter(ExoPlayer.class::equals)
            .count();
        long facades = Arrays.stream(
            CrateNativePlaybackService.class.getDeclaredFields()
        )
            .map(Field::getType)
            .filter(CrateMixPlayer.class::equals)
            .count();

        assertEquals(2L, physicalPlayers);
        assertEquals(1L, facades);
    }

    @Test
    public void eachPhysicalDeckOwnsAnAudioThreadGainProcessor() {
        long processors = Arrays.stream(
            CrateNativePlaybackService.class.getDeclaredFields()
        )
            .map(Field::getType)
            .filter(NativeMixAudioProcessor.class::equals)
            .count();

        assertEquals(2L, processors);
    }

    @Test
    public void baselineKeepsOneLogicalQueueRevision() {
        long revisionFields = Arrays.stream(
            NativeQueueState.class.getDeclaredFields()
        )
            .filter(field -> field.getName().equals("revision"))
            .count();

        assertEquals(1L, revisionFields);
    }
}
