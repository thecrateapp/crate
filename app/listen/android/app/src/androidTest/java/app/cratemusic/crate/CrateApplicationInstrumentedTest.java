package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.media3.common.MediaItem;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CrateApplicationInstrumentedTest {
    @Test
    public void usesTheCrateApplicationId() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("app.cratemusic.crate", appContext.getPackageName());
    }

    @Test
    public void restoredPlaybackItemHasAnOpaqueLocalConfiguration() {
        NativeTrack track =
            new NativeTrack(
                "track-1",
                "",
                "",
                "Track",
                "Artist",
                "Album",
                "https://api.example/artwork/1?media_ticket=secret",
                180_000L,
                null
            );

        MediaItem item = CrateNativePlaybackService.toCheckpointMediaItem(track);

        assertNotNull(item.localConfiguration);
        assertEquals("crate-resume", item.localConfiguration.uri.getScheme());
        assertFalse(item.localConfiguration.uri.toString().contains("secret"));
        assertFalse(item.localConfiguration.uri.toString().contains("api.example"));
    }
}
