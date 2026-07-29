package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.util.Arrays;

import org.junit.Test;
import org.junit.runner.RunWith;

@UnstableApi
@RunWith(AndroidJUnit4.class)
public class ExoPlayerNativePlaybackDeckTest {
    @Test
    public void preparesTheRequestedTrackFromTheSharedLogicalQueue() {
        Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
        ExoPlayer player = new ExoPlayer.Builder(context).build();
        ExoPlayerNativePlaybackDeck deck =
            new ExoPlayerNativePlaybackDeck(
                player,
                new NativeMixAudioProcessor()
            );
        NativeTrack first = track("first");
        NativeTrack second = track("second");

        try {
            deck.replaceQueue(
                Arrays.asList(first, second),
                Arrays.asList(item("first"), item("second")),
                0,
                0L
            );
            deck.prepare(second, 1200L);

            assertEquals(1, player.getCurrentMediaItemIndex());
            assertEquals(1200L, player.getCurrentPosition());
            assertEquals(
                "second",
                player.getCurrentMediaItem().mediaId
            );
        } finally {
            player.release();
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
            180_000L,
            null
        );
    }

    private static MediaItem item(String id) {
        return new MediaItem.Builder()
            .setMediaId(id)
            .setUri("https://example.test/" + id)
            .build();
    }
}
