package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.Looper;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
@LooperMode(LooperMode.Mode.PAUSED)
public class CrateMixPlayerEndedReplayTest {
    private static final class RecordingPlayer extends SimpleBasePlayer {
        final List<String> calls = new ArrayList<>();
        int playbackState;
        boolean playWhenReady;
        long positionMs;

        RecordingPlayer(int playbackState, long positionMs) {
            super(Looper.getMainLooper());
            this.playbackState = playbackState;
            this.positionMs = positionMs;
            this.playWhenReady = playbackState == Player.STATE_ENDED;
        }

        @Override
        protected State getState() {
            return new State.Builder()
                .setAvailableCommands(
                    new Player.Commands.Builder().addAllCommands().build()
                )
                .setPlaylist(
                    ImmutableList.of(
                        new MediaItemData.Builder("first")
                            .setMediaItem(MediaItem.fromUri("https://example.test/1"))
                            .setDurationUs(180_000_000L)
                            .build(),
                        new MediaItemData.Builder("last")
                            .setMediaItem(MediaItem.fromUri("https://example.test/2"))
                            .setDurationUs(44_000_000L)
                            .build()
                    )
                )
                .setCurrentMediaItemIndex(1)
                .setContentPositionMs(positionMs)
                .setPlaybackState(playbackState)
                .setPlayWhenReady(
                    playWhenReady,
                    Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST
                )
                .build();
        }

        @Override
        protected ListenableFuture<?> handleSeek(
            int mediaItemIndex,
            long positionMs,
            int seekCommand
        ) {
            calls.add("seek " + mediaItemIndex + " " + positionMs);
            this.positionMs = positionMs;
            playbackState = Player.STATE_READY;
            return Futures.immediateVoidFuture();
        }

        @Override
        protected ListenableFuture<?> handleSetPlayWhenReady(boolean playWhenReady) {
            calls.add("playWhenReady " + playWhenReady);
            this.playWhenReady = playWhenReady;
            return Futures.immediateVoidFuture();
        }
    }

    @Test
    public void playingAnEndedTrackRestartsItFromTheBeginning() {
        RecordingPlayer deck = new RecordingPlayer(Player.STATE_ENDED, 44_000L);
        List<String> intercepted = new ArrayList<>();
        CrateMixPlayer player = new CrateMixPlayer(
            deck,
            new CrateMixPlayer.CommandInterceptor() {
                @Override
                public void beforeSeek(int mediaItemIndex, long positionMs, int seekCommand) {
                    intercepted.add("seek " + mediaItemIndex + " " + positionMs);
                }
            }
        );

        player.play();

        assertEquals(List.of("seek 1 0", "playWhenReady true"), deck.calls);
        assertEquals(List.of("seek 1 0"), intercepted);
        assertEquals(Player.STATE_READY, deck.getPlaybackState());
        assertTrue(deck.getPlayWhenReady());
    }

    @Test
    public void resumingAPausedTrackKeepsItsPosition() {
        RecordingPlayer deck = new RecordingPlayer(Player.STATE_READY, 21_000L);
        CrateMixPlayer player = new CrateMixPlayer(deck);

        player.play();

        assertEquals(List.of("playWhenReady true"), deck.calls);
    }

    @Test
    public void refusedFocusLeavesAnEndedTrackAtItsEnd() {
        RecordingPlayer deck = new RecordingPlayer(Player.STATE_ENDED, 44_000L);
        CrateMixPlayer player = new CrateMixPlayer(
            deck,
            new CrateMixPlayer.CommandInterceptor() {
                @Override
                public boolean beforePlay() {
                    return false;
                }
            }
        );

        player.play();

        assertTrue(deck.calls.isEmpty());
        assertEquals(Player.STATE_ENDED, deck.getPlaybackState());
    }
}
