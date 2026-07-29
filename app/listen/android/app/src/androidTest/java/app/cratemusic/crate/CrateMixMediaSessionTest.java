package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import android.content.Context;

import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@UnstableApi
@RunWith(AndroidJUnit4.class)
public class CrateMixMediaSessionTest {
    @Test
    public void mediaSessionKeepsTheSameFacadeAcrossDeckPromotion() {
        Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
        ExoPlayer first = new ExoPlayer.Builder(context).build();
        ExoPlayer second = new ExoPlayer.Builder(context).build();
        CrateMixPlayer facade = new CrateMixPlayer(first);
        MediaSession session = new MediaSession.Builder(context, facade)
            .setId("crate-mix-test")
            .build();

        try {
            facade.promote(second);

            assertSame(facade, session.getPlayer());
            assertSame(second, facade.activePlayer());
        } finally {
            session.release();
            facade.release();
            first.release();
        }
    }

    @Test
    public void mediaSessionTransportCommandsReachTheInterceptor() {
        Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
        ExoPlayer physicalPlayer =
            new ExoPlayer.Builder(context).build();
        int[] stops = new int[] { 0 };
        CrateMixPlayer facade = new CrateMixPlayer(
            physicalPlayer,
            new CrateMixPlayer.CommandInterceptor() {
                @Override
                public void beforeStop() {
                    stops[0]++;
                }
            }
        );

        try {
            facade.stop();
            assertEquals(1, stops[0]);
        } finally {
            facade.release();
        }
    }

    @Test
    public void playCanBeRejectedWhenAudioFocusIsUnavailable() {
        Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
        ExoPlayer physicalPlayer =
            new ExoPlayer.Builder(context).build();
        int[] playRequests = new int[] { 0 };
        CrateMixPlayer facade = new CrateMixPlayer(
            physicalPlayer,
            new CrateMixPlayer.CommandInterceptor() {
                @Override
                public boolean beforePlay() {
                    playRequests[0]++;
                    return false;
                }
            }
        );

        try {
            facade.play();

            assertEquals(1, playRequests[0]);
            assertEquals(false, facade.getPlayWhenReady());
        } finally {
            facade.release();
        }
    }

    @Test
    public void deniedSharedAudioFocusPreventsPhysicalPlayback() {
        Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
        ExoPlayer physicalPlayer =
            new ExoPlayer.Builder(context).build();
        int[] requests = new int[] { 0 };
        CrateMixPlayer facade = new CrateMixPlayer(
            physicalPlayer,
            new CrateMixPlayer.CommandInterceptor() {
                @Override
                public boolean beforePlay() {
                    requests[0]++;
                    return false;
                }
            }
        );

        try {
            facade.play();

            assertEquals(1, requests[0]);
            assertEquals(false, physicalPlayer.getPlayWhenReady());
        } finally {
            facade.release();
        }
    }
}
